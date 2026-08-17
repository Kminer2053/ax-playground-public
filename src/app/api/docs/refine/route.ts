import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { buildDocPrompt, parseDocJson, repairDoc, extractJson, isDocFormat, type DocFormat } from "@/lib/docs-generate";

export const dynamic = "force-dynamic";

/**
 * POST /api/docs/refine — '작성 컨텐츠'(중간 정리 구조)를 자연어 지시로 수정.
 *  현재는 직접 편집만 가능하던 구조를, 사용자가 "더 간결하게" "OO 항목 추가" 같은 지시로 고칠 수 있게 한다.
 *  body(JSON): { format, structure(현재 구조 객체), instruction(수정 지시) }
 *   - 표준양식: 스키마를 유지한 채 LLM이 수정 → parseDocJson으로 재검증(형식 보장)
 *   - 임의양식 폼(__form): fields[{label,value}]의 value만 지시대로 수정(라벨·구조 불변)
 *  → { ok, structure } (수정된 구조) / 실패 시 { error }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { format?: string; structure?: unknown; instruction?: string } | null;
  const format = String(body?.format || "");
  const instruction = String(body?.instruction || "").trim();
  const structure = body?.structure;
  if (!instruction) return NextResponse.json({ error: "수정 지시를 입력해 주세요." }, { status: 400 });
  if (!structure || typeof structure !== "object") return NextResponse.json({ error: "수정할 작성 컨텐츠가 없습니다." }, { status: 400 });

  const ctx = await buildGuardContext(req, "docs");

  // ── 임의양식 폼: 라벨 고정, 값만 수정 ──
  if ((structure as { __form?: boolean }).__form) {
    const fields = ((structure as { fields?: { label: string; value?: string }[] }).fields ?? []);
    const sys = "당신은 서식 값 편집 도우미입니다. 아래 [필드]의 label은 그대로 두고 value만 사용자 지시대로 고쳐, "
      + '다른 텍스트 없이 JSON 배열 하나만 출력하세요: [{"label":"...","value":"..."}]. '
      + "라벨을 추가·삭제·변경하지 말고, 지시와 무관한 필드는 기존 value를 유지하세요.";
    const user = `[필드]\n${JSON.stringify(fields, null, 1)}\n\n[수정 지시]\n${instruction}`;
    let raw: string;
    try {
      raw = await guardedChat({ messages: [{ role: "user", content: user }], ctx, system: sys, maxTokens: 2000, temperature: 0.2, guardInput: instruction });
    } catch (e) {
      if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
      return NextResponse.json({ error: "수정에 실패했습니다." }, { status: 502 });
    }
    try {
      const a = raw.indexOf("["), z = raw.lastIndexOf("]");
      const arr = JSON.parse(raw.slice(a, z + 1)) as { label?: string; value?: string }[];
      const byLabel = new Map(arr.map((f) => [String(f.label ?? ""), String(f.value ?? "")]));
      // 원본 라벨 순서·집합 보존 — LLM이 라벨을 바꿔도 원본 기준으로만 값 반영
      const merged = fields.map((f) => ({ label: f.label, value: byLabel.has(f.label) ? byLabel.get(f.label)! : (f.value ?? "") }));
      return NextResponse.json({ ok: true, structure: { ...(structure as object), fields: merged } });
    } catch {
      return NextResponse.json({ error: "수정 결과를 해석하지 못했습니다. 지시를 더 구체적으로 적어 주세요." }, { status: 502 });
    }
  }

  // ── 표준양식: 스키마 유지 수정 ──
  if (!isDocFormat(format)) return NextResponse.json({ error: "지원하지 않는 양식입니다." }, { status: 400 });
  const fmt = format as DocFormat;
  const cfg = await getPlaygroundConfig().catch(() => null);
  const sys = `${buildDocPrompt(fmt, cfg?.ceoName, cfg?.orgName)}\n\n[중요] 아래 '현재 구조'를 사용자의 '수정 지시'대로 고치되, 위 스키마(키·구조)를 반드시 유지하세요. 지시와 무관한 내용은 그대로 두고, 다른 텍스트 없이 JSON 객체 하나만 출력하세요.`;
  const user = `[현재 구조]\n${JSON.stringify(structure, null, 1)}\n\n[수정 지시]\n${instruction}`;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await guardedChat({
        messages: [{ role: "user", content: attempt === 0 ? user : `${user}\n\n[재시도 — 직전 출력이 스키마에 맞지 않았습니다: ${lastErr}] 스키마를 지켜 JSON 객체만 출력.` }],
        ctx, system: sys, maxTokens: 3500, temperature: attempt === 0 ? 0.3 : 0.4, guardInput: instruction,
      });
    } catch (e) {
      if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
      return NextResponse.json({ error: "수정에 실패했습니다." }, { status: 502 });
    }
    try {
      const obj = extractJson(raw);
      const data = parseDocJson(fmt, obj);
      recordUsage("docs", "refine"); // 자연어 지시로 내용 수정
      return NextResponse.json({ ok: true, structure: data });
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 120) : "형식 오류";
    }
  }
  // 안전망: best-effort 보강 후 재검증
  try {
    const data = parseDocJson(fmt, repairDoc(fmt, structure, "", cfg?.orgName));
    return NextResponse.json({ ok: true, structure: data, note: "지시를 완전히 반영하지 못해 기존 구조를 유지했습니다." });
  } catch {
    return NextResponse.json({ error: "수정 결과가 양식에 맞지 않습니다. 지시를 더 구체적으로 적어 주세요." }, { status: 502 });
  }
}
