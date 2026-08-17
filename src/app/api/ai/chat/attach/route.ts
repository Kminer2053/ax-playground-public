/**
 * POST /api/ai/chat/attach (multipart: files[]) — 문서작성 사이드챗 첨부 인덱싱.
 * 전문 추출 → 가드 전수검사 → 계층 판정(소형=전문/대형=청킹+임베딩) → TTL 캐시(24h) → attId 반환.
 * 이후 대화는 attId만 보내고, 서버가 턴마다 질문에 맞는 부분을 발췌해 주입한다(파일 크기 무관 활용).
 */
import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectDb } from "@/lib/db";
import { recordUsage } from "@/lib/usage";
import { parseAttachment, toPlainText } from "@/lib/docparse";
import { extractRegulationFile, isLikelyScannedPdf } from "@/lib/regulations-extract";
import { indexAttachment, ATT_MAX_CHARS, ATT_SMALL_MAX } from "@/lib/chat-attachments";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 대형 문서 임베딩(30만자 ≈ 30~60초) + 동의 시 스캔 PDF OCR 여유

const OCR_MAX_PAGES = 60; // 동의 후 OCR 페이지 상한(챗 첨부는 검색형 활용이라 조금 넉넉히)

const MAX_FILES = 4;
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `최대 ${MAX_FILES}개까지 가능합니다.` }, { status: 400 });

  await connectDb();
  recordUsage("docs", "attach");

  const dir = await mkdtemp(path.join(tmpdir(), "axchat-att-"));
  try {
    const results = [];
    for (const f of files) {
      const format = path.extname(f.name).replace(".", "") || "unknown";
      if (f.size > MAX_BYTES) {
        results.push({ name: f.name, format, ok: false, error: "파일이 20MB를 초과합니다." });
        continue;
      }
      try {
        const safe = path.basename(f.name).replace(/[^\w.\-가-힣]/g, "_");
        const p = path.join(dir, `up_${safe}`);
        await writeFile(p, Buffer.from(await f.arrayBuffer()));
        const ext = path.extname(f.name).toLowerCase();
        const wantOcr = String(form.get("ocr") || "") === "1"; // 'OCR로 읽기' 동의 재요청

        if (wantOcr && ext === ".pdf") {
          const ex = await extractRegulationFile(p, f.name, { ocrMaxPages: OCR_MAX_PAGES, allowOcr: true });
          const plain = toPlainText(ex.text);
          if (!plain.trim()) { results.push({ name: f.name, format: "pdf", ok: false, error: "OCR로도 텍스트를 인식하지 못했습니다." }); continue; }
          const s = await indexAttachment(f.name, "pdf", plain);
          results.push({ ...s, ok: true, method: ex.method, note: ex.note });
          continue;
        }

        const r = await parseAttachment(p, f.name);
        const plain0 = r.ok ? toPlainText(r.markdown) : "";
        // 스캔(이미지) PDF: 실패 대신 'OCR로 읽을까요?' 선택지 반환 → UI 버튼으로 ocr=1 재업로드
        if (ext === ".pdf" && isLikelyScannedPdf(ext, plain0)) {
          results.push({ name: f.name, format: "pdf", ok: false, needsOcr: true, error: `스캔 이미지 PDF — OCR(앞 ${OCR_MAX_PAGES}쪽)로 읽을 수 있습니다.` });
          continue;
        }
        if (!r.ok) { results.push({ name: f.name, format: r.format, ok: false, error: r.error || "추출 실패" }); continue; }
        if (!plain0.trim()) { results.push({ name: f.name, format: r.format, ok: false, error: "텍스트를 추출하지 못했습니다." }); continue; }
        const s = await indexAttachment(f.name, r.format, plain0);
        results.push({ ...s, ok: true });
      } catch (e) {
        results.push({ name: f.name, format, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "인덱싱 실패" });
      }
    }
    return NextResponse.json({ ok: true, results, limits: { maxChars: ATT_MAX_CHARS, smallMax: ATT_SMALL_MAX } }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
