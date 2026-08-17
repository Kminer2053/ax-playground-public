/**
 * 임의양식(HWPX) 편집계획 — kordoc HwpxSession으로 블록별 편집 가능 영역을 판정한다.
 *
 * 현행 문서형 임의양식은 "표·각주 뺀 본문 문단을 통째 교체"라 긴 양식에서 고정 지문까지
 * 갈아엎는 위험이 있었다. 여기서는 kordoc의 셀 단위 capability(편집 가능/잠금+사유)로
 * [본문 문단 | 표 작성셀 | 잠금]을 먼저 지도화하고, 생성은 편집 가능 영역에만 증분 패치한다
 * (n회 증분 ≡ 일괄 patch 동등성은 kordoc CI가 보장). 비편집 영역은 구조적으로 불변.
 *
 * .hwp(구버전 바이너리)는 세션 미지원 — 호출부가 기존 CLI patch 플로우로 폴백한다.
 */
import { openHwpxDocument } from "kordoc";

export type EditCell = { row: number; col: number; text: string; label: string };
export type EditArea =
  | { blockIndex: number; kind: "본문"; text: string }
  | { blockIndex: number; kind: "표"; cells: EditCell[] };

export type EditSlot = {
  id: string; // "S1"… — LLM은 이 ID로만 편집을 지정한다(좌표 산출을 시키면 경량모델이 틀림: 실측)
  blockIndex: number;
  kind: "본문" | "표셀";
  row?: number;
  col?: number;
  label?: string; // 표셀: 행 라벨/열 헤더
  text: string; // 현재 내용
  placeholder: boolean; // 안내·예시 지문 — 반드시 교체
  paras?: number; // 표셀의 원본 문단(줄) 수 — kordoc은 줄 수 동일 교체만 완전 적용(삭제 미지원: 실측)
};

export type EditPlan = {
  blockTotal: number;
  lockedBlocks: number; // 잠금(중첩표·글상자 등 매핑 신뢰 불가) — 절대 건드리지 않는 영역
  areas: EditArea[];
  slots: EditSlot[];
  /** LLM 프롬프트용 슬롯 카탈로그 — 이 목록에 없는 곳은 편집 불가 */
  catalog: string;
};

export type HwpxEditSession = {
  plan: EditPlan;
  /** LLM이 낸 edits를 검증(계획에 있는 블록·셀만 통과) 후 증분 패치 → 결과 바이트 */
  apply: (edits: PlanEdit[]) => Promise<{ bytes: Uint8Array; applied: number; skipped: { blockIndex: number; reason: string }[] }>;
  /** 슬롯 ID→값 맵(LLM 출력)을 좌표 edits로 변환해 적용 — 좌표는 코드가 보증 */
  applySlots: (values: Record<string, string>) => Promise<{ bytes: Uint8Array; applied: number; skipped: { blockIndex: number; reason: string }[] }>;
};

export type PlanEdit =
  | { blockIndex: number; newText: string }
  | { blockIndex: number; cells: { row: number; col: number; text: string }[] };

type Cap = { capability: "text" | "cell-text" | "locked"; cells?: { editable: boolean; reason?: string }[][]; reason?: string };
type Block = { text?: string; markdown?: string; table?: { cells?: { text?: string }[][] }; cells?: { text?: string }[][] };

const cellGrid = (b: Block | undefined) => b?.table?.cells ?? b?.cells; // 표 블록은 block.table.cells[row][col]
const cellText = (b: Block | undefined, r: number, c: number): string =>
  String(cellGrid(b)?.[r]?.[c]?.text ?? "").replace(/\s+/g, " ").trim();

/** 편집 셀의 '무엇을 쓰는 칸인지' — 같은 행 왼쪽(행 라벨) 우선, 없으면 같은 열 위쪽(열 헤더)의
 *  가장 가까운 비어있지 않은 셀 텍스트. 세로쓰기 라벨("점검기간")도 이 규칙으로 잡힌다. */
function cellLabel(b: Block | undefined, r: number, c: number): string {
  for (let cc = c - 1; cc >= 0; cc--) {
    const t = cellText(b, r, cc);
    if (t) return t.slice(0, 30);
  }
  for (let rr = r - 1; rr >= 0; rr--) {
    const t = cellText(b, rr, c);
    if (t) return t.slice(0, 30);
  }
  return "";
}

/** 폰트 안내·예시 지문(placeholder) — 실제 내용으로 반드시 교체돼야 하는 블록 */
const PLACEHOLDER_RE = /POINT|포인트|폰트|글꼴|바탕체|명조|고딕|헤드라인|여기에\s*(입력|작성)|을\(를\)?\s*입력|샘플|예시\s*문/i;

/** 새 텍스트를 원본 문단 수(target)에 맞춘다 — kordoc patchBlocks는 셀 내 '줄 삭제'를 미지원(실측:
 *  동수 교체만 완전 적용). 초과분은 마지막 문단에 병합, 부족분은 문장 단위 재분배 후 공백 패딩. */
export function fitParagraphs(next: string, target: number): string {
  const paras = next.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (target <= 1) return paras.join(" ");
  if (paras.length === target) return paras.join("\n");
  if (paras.length > target) return [...paras.slice(0, target - 1), paras.slice(target - 1).join(" ")].join("\n");
  // 부족 — 불릿(o·-·•) 또는 문장(마침표) 단위로 쪼개 target개로 재분배
  const joined = paras.join(" ");
  const units = joined.split(/(?=\s[o○•▪-]\s)|(?<=[.!?」』])\s+/).map((s) => s.trim()).filter(Boolean);
  if (units.length >= target) {
    const per = Math.ceil(units.length / target);
    const out: string[] = [];
    for (let i = 0; i < target; i++) out.push(units.slice(i * per, (i + 1) * per).join(" ").trim());
    if (out.every(Boolean)) return out.join("\n");
  }
  // 문장 수 < 줄 수: 문장을 한 줄씩 배분하고 남는 줄만 공백 패딩(빈 줄로 보일 수 있으나 skip 없이 전량 적용)
  const base = units.length ? units : paras;
  return [...base, ...Array(Math.max(0, target - base.length)).fill(" ")].join("\n");
}

/** 슬롯 목록 → LLM 카탈로그 문자열(배치 분할 생성 시 부분 목록에도 사용) */
export function catalogFor(slots: EditSlot[]): string {
  return slots
    .map((s) =>
      s.kind === "본문"
        ? `${s.id} = [본문${s.placeholder ? " · 안내/예시 지문 — 실제 내용으로 교체 필요" : ""}] ${s.text.slice(0, 150)}`
        : `${s.id} = [표 «${s.label || "라벨 없음"}» 칸${(s.paras ?? 1) > 1 ? ` · ${s.paras}줄 구성` : ""}${s.placeholder ? " · 안내문 — 실제 값으로 교체 필요" : ""}]${s.text ? ` 현재="${s.text.slice(0, 40)}"` : " (빈칸)"}`,
    )
    .join("\n");
}

export async function openHwpxEditSession(bytes: Uint8Array): Promise<HwpxEditSession> {
  const session = await openHwpxDocument(bytes);
  const blocks = (session.blocks ?? []) as Block[];

  const areas: EditArea[] = [];
  let locked = 0;
  for (let i = 0; i < blocks.length; i++) {
    const cap = session.capability(i) as Cap;
    if (cap.capability === "locked") { locked++; continue; }
    if (cap.capability === "text") {
      const text = String(blocks[i]?.text ?? blocks[i]?.markdown ?? "").trim();
      if (!text) continue; // 빈 문단은 편집 대상 아님(레이아웃 여백)
      // 양식 구조물 보호: 섹션 제목("1. 위원 정보")·※ 주석 안내문·짧은 라벨("소 속 :")은
      // placeholder(교체 필요 지문)가 아닌 한 편집 대상에서 제외 — 값 덤프·제목 소실 하자 실측.
      const isStructural = /^\d+\s*[.)]\s/.test(text) || /^[※▶]/.test(text) || (text.length <= 14 && /[:：]\s*$/.test(text));
      if (isStructural && !PLACEHOLDER_RE.test(text)) continue;
      areas.push({ blockIndex: i, kind: "본문", text });
      continue;
    }
    // cell-text: editable=true 셀만 카탈로그에 올린다(병합 빈칸·좌표 불일치 셀은 kordoc이 이미 차단).
    // 각 셀에 행 라벨/열 헤더를 붙인다 — 좌표만 주면 LLM이 '어떤 칸의 값인지' 몰라 오배치한다(실측).
    let cells: EditCell[] = [];
    (cap.cells ?? []).forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell.editable) cells.push({ row: r, col: c, text: cellText(blocks[i], r, c), label: cellLabel(blocks[i], r, c) });
      }),
    );
    // 라벨 덮임 원천 차단: 빈 값 칸이 하나라도 있는 표에서는 텍스트 보유 셀(라벨·헤더 성격)을
    // 편집 대상에서 제외한다 — LLM 지시가 아니라 화이트리스트가 막는다(실측: 지시만으론 라벨에 값을 씀).
    // 빈칸이 전혀 없는 표(기존 문서 수정 시나리오)는 텍스트 셀 편집을 유지.
    if (cells.some((c) => !c.text)) cells = cells.filter((c) => !c.text);
    if (cells.length) areas.push({ blockIndex: i, kind: "표", cells });
  }

  // 슬롯 부여: LLM에는 S1·S2… ID만 노출하고 좌표(blockIndex·row·col)는 코드가 보관한다.
  const slots: EditSlot[] = [];
  for (const a of areas) {
    if (a.kind === "본문") {
      slots.push({ id: `S${slots.length + 1}`, blockIndex: a.blockIndex, kind: "본문", text: a.text, placeholder: PLACEHOLDER_RE.test(a.text) });
    } else {
      for (const c of a.cells.slice(0, 40)) {
        const rawCell = String(cellGrid(blocks[a.blockIndex])?.[c.row]?.[c.col]?.text ?? "");
        const paras = rawCell.split(/\n/).filter((l) => l.trim()).length || 1;
        const cellPh = PLACEHOLDER_RE.test(c.text) || /※.*(기재|입력|작성)|기재하세요|입력하세요/.test(c.text);
        slots.push({ id: `S${slots.length + 1}`, blockIndex: a.blockIndex, kind: "표셀", row: c.row, col: c.col, label: c.label, text: c.text, placeholder: cellPh, paras });
      }
    }
  }
  const catalog = catalogFor(slots);

  const allow = new Map<number, EditArea>(areas.map((a) => [a.blockIndex, a]));
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const applyEdits = async (edits: PlanEdit[]) => {
    const skipped: { blockIndex: number; reason: string }[] = [];
    const safe: PlanEdit[] = [];
    for (const e of edits) {
      const area = allow.get(e.blockIndex);
      if (!area) { skipped.push({ blockIndex: e.blockIndex, reason: "편집계획에 없는 블록" }); continue; }
      if ("newText" in e) {
        if (area.kind !== "본문") { skipped.push({ blockIndex: e.blockIndex, reason: "표 블록에 본문 편집 시도" }); continue; }
        if (!e.newText.trim()) { skipped.push({ blockIndex: e.blockIndex, reason: "빈 텍스트" }); continue; }
        safe.push(e);
      } else {
        if (area.kind !== "표") { skipped.push({ blockIndex: e.blockIndex, reason: "본문 블록에 셀 편집 시도" }); continue; }
        const ok = new Set(area.cells.map((c) => `${c.row},${c.col}`));
        const cells = (e.cells ?? []).filter((c) => ok.has(`${c.row},${c.col}`) && String(c.text ?? "").trim());
        if (!cells.length) { skipped.push({ blockIndex: e.blockIndex, reason: "편집 가능 셀 없음(좌표 불일치)" }); continue; }
        safe.push({ blockIndex: e.blockIndex, cells });
      }
    }
    if (!safe.length) return { bytes, applied: 0, skipped };
    const r = (await session.patchBlocks(safe)) as { success: boolean; applied: number; skipped?: { blockIndex?: number; reason?: string }[]; data: Uint8Array };
    for (const s of r.skipped ?? []) skipped.push({ blockIndex: s.blockIndex ?? -1, reason: s.reason ?? "kordoc skip" });
    return { bytes: r.data ?? bytes, applied: r.applied ?? 0, skipped };
  };

  return {
    plan: { blockTotal: blocks.length, lockedBlocks: locked, areas, slots, catalog },
    apply: applyEdits,
    async applySlots(values: Record<string, string>) {
      // 슬롯 값 → 좌표 edits(같은 블록의 셀들은 병합) — 좌표는 slots가 보증하므로 불일치가 없다
      const perBlockCells = new Map<number, { row: number; col: number; text: string }[]>();
      const edits: PlanEdit[] = [];
      const skipped: { blockIndex: number; reason: string }[] = [];
      const norm = (s: string) => s.replace(/\s+/g, "");
      for (const [id, raw] of Object.entries(values)) {
        const slot = slotById.get(id.trim().toUpperCase());
        const text = String(raw ?? "").trim();
        if (!slot) { skipped.push({ blockIndex: -1, reason: `알 수 없는 슬롯 ${id}` }); continue; }
        if (!text) continue;
        // 복창 차단: 경량모델이 카탈로그의 '현재값' 조각·표기를 답으로 복사하는 실패 모드(실측) —
        // ①동일 ②접두 조각 ③카탈로그 포장(현재="…") ④원문+장식(새 값이 원문을 통째 포함) 전부 무시.
        const stripWrap = (t: string) => t.replace(/현재\s*=\s*"/g, "").replace(/["«»""]/g, "").replace(/[○●◦•▶※o]\s*/g, "");
        const oldN = norm(stripWrap(slot.text)), newN = norm(stripWrap(text));
        if (oldN) {
          if (oldN === newN) continue;
          if (newN.length < oldN.length && oldN.startsWith(newN)) continue; // 접두 조각
          if (newN.includes(oldN) && newN.length < oldN.length + 40) continue; // 원문+포장·장식(현재="…" 류)
        }
        if (/^현재\s*=/.test(text.trim())) continue; // 카탈로그 표기 자체를 답으로 낸 경우
        if (slot.kind === "본문") edits.push({ blockIndex: slot.blockIndex, newText: text });
        else {
          const arr = perBlockCells.get(slot.blockIndex) ?? [];
          // 다문단 셀은 원본 줄 수로 정규화 — 줄 수 불일치 편집은 kordoc이 부분 skip(실측)
          arr.push({ row: slot.row!, col: slot.col!, text: (slot.paras ?? 1) > 1 ? fitParagraphs(text, slot.paras!) : text });
          perBlockCells.set(slot.blockIndex, arr);
        }
      }
      for (const [blockIndex, cells] of perBlockCells) edits.push({ blockIndex, cells });
      const r = await applyEdits(edits);
      return { ...r, skipped: [...skipped, ...r.skipped] };
    },
  };
}
