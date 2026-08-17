import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAttachment, toPlainText } from "@/lib/docparse";
import { extractRegulationFile, isLikelyScannedPdf } from "@/lib/regulations-extract";
import { normalizeExtracted } from "@/lib/regulations-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 스캔 PDF OCR(사용자 동의 시) 여유

const MAX_FILES = 3;
const MAX_BYTES = 20 * 1024 * 1024; // 사이드챗 첨부(ai/chat/attach)와 동일 한도 — 12MB급 책자 PDF도 kordoc가 수초 내 처리(실측 238p/1.6s)
const PREVIEW_CHARS = 4000;   // 대화 주입용 평문(컨텍스트)
const MD_CHARS = 60000;       // 우측 표출용 구조화 마크다운(가독성)
export const OCR_MAX_PAGES = 40; // 동의 후 OCR 페이지 상한(응답성 — RapidOCR 수 초/쪽)

/**
 * POST /api/docs/parse (multipart: files[]) — 첨부 파일을 즉시 파싱해 추출 텍스트
 * 미리보기를 반환. 사용자가 "내용 파악이 제대로 됐는지" 생성 전에 확인하기 위함.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `최대 ${MAX_FILES}개까지 가능합니다.` }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "axparse-"));
  try {
    const results = [];
    for (const f of files) {
      const format = path.extname(f.name).replace(".", "") || "unknown";
      if (f.size > MAX_BYTES) {
        results.push({ name: f.name, format, ok: false, chars: 0, preview: "", error: "파일이 20MB를 초과합니다." });
        continue;
      }
      const safe = path.basename(f.name).replace(/[^\w.\-가-힣]/g, "_");
      const p = path.join(dir, `up_${safe}`);
      await writeFile(p, Buffer.from(await f.arrayBuffer()));
      const ext = path.extname(f.name).toLowerCase();
      const wantOcr = String(form.get("ocr") || "") === "1"; // 사용자가 'OCR로 읽기'에 동의한 재요청

      if (wantOcr && ext === ".pdf") {
        // 동의 후: 사규 적재와 동일한 OCR 에스컬레이션 재사용(텍스트층 있으면 그대로, 스캔이면 OCR)
        const ex = await extractRegulationFile(p, f.name, { ocrMaxPages: OCR_MAX_PAGES, allowOcr: true });
        const plain = toPlainText(ex.text);
        const md = normalizeExtracted(ex.text);
        results.push({
          name: f.name, format: "pdf", ok: ex.chars > 0, chars: plain.length,
          preview: plain.slice(0, PREVIEW_CHARS), markdown: md.slice(0, MD_CHARS), truncated: md.length > MD_CHARS,
          method: ex.method, note: ex.note,
          error: ex.chars > 0 ? undefined : "OCR로도 텍스트를 인식하지 못했습니다.",
        });
        continue;
      }

      const r = await parseAttachment(p, f.name);
      const plain = toPlainText(r.markdown);
      // 스캔(이미지) PDF: 실패로 끝내지 않고 'OCR로 읽을까요?' 선택지를 UI에 제공
      if (ext === ".pdf" && isLikelyScannedPdf(ext, plain)) {
        results.push({
          name: f.name, format: "pdf", ok: false, chars: 0, preview: "", needsOcr: true,
          error: `스캔 이미지 PDF로 보입니다 — 'OCR로 읽기'를 누르면 한국어 OCR(앞 ${OCR_MAX_PAGES}쪽)로 인식합니다.`,
        });
        continue;
      }
      const md = normalizeExtracted(r.markdown); // 표 HTML→파이프 + 개요/거대제목 마커 정리(가독·균일 글자)
      results.push({
        name: r.name,
        format: r.format,
        ok: r.ok,
        chars: r.chars,
        preview: plain.slice(0, PREVIEW_CHARS),   // 대화 컨텍스트(평문)
        markdown: md.slice(0, MD_CHARS),          // 우측 표출(구조화)
        truncated: md.length > MD_CHARS,
        error: r.error,
      });
    }
    recordUsage("docs", "parse"); // 원본 분석(첨부 추출·OCR)
    return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
