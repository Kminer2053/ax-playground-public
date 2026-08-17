/**
 * 사규 md 원본을 DB 기준으로 재생성 — data/regulations-2026이 DB보다 뒤처져(유실 수정
 * 재적재분 미반영) 재적재 소스로 쓰면 회귀하는 문제의 해소.
 *
 * 각 md의 프런트매터 문서명으로 DB 문서를 찾아 조문에서 본문을 재구성하고,
 * **라운드트립 검증(재구성문 → ingestText → DB 조문과 이름·본문 완전 일치) 통과 시에만**
 * 파일을 덮어쓴다. 재구성 규칙 3종을 순서대로 시도하고 첫 통과 규칙을 쓴다.
 *
 * 실행: npx tsx src/scripts/export-regulations-md.ts [--write]  (기본 dry-run)
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { ingestText } from "@/lib/regulations-ingest";

type Art = { name: string; fullText?: string; page?: string };
type DbDoc = { title: string; category?: string; articles?: Art[]; metadata?: { origMeta?: Record<string, string> } };

const normText = (s?: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const nospace = (s: string) => s.replace(/\s+/g, "");

function parseFm(raw: string): { fm: Record<string, string>; } {
  const m = raw.match(/^\\?---\n([\s\S]*?)\n\\?---/);   // PDF 추출본은 \--- 로 이스케이프됨
  const fm: Record<string, string> = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm };
}

function fmBlock(fm: Record<string, string>): string {
  return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
}

/** 이름의 마커(제N조·Ⅰ.1·[p.N] 등)를 뗀 제목부가 본문 첫머리에 이미 있는지 */
function bodyCoversHeading(ft: string, name: string) {
  const headText = nospace(name.replace(/^\[p\.\d+\]\s*/, "").replace(/^[Ⅰ-Ⅻⅰ-ⅻ]+[.．]?\s*[\d.]*\s*/, "").replace(/^제\s*\d+[조항]\s*(\([^)]*\))?/, ""));
  const first = nospace(ft.split("\n")[0] ?? "");
  return headText.length >= 2 && first.startsWith(headText.slice(0, Math.min(headText.length, 12)));
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 청크상한(sizeCap) 분할 청크 재병합 — "이름 — 헤딩"/"이름 (N)" 꼴 연속 청크를 원청크로 합친다. */
function mergeSplit(arts: Art[]): Art[] {
  const out: Art[] = [];
  for (const a of arts) {
    const p = out[out.length - 1];
    if (p && (a.name.startsWith(`${p.name} — `) || new RegExp(`^${escRe(p.name)} \\(\\d+\\)$`).test(a.name)))
      p.fullText = `${(p.fullText ?? "").replace(/\s+$/, "")}\n${(a.fullText ?? "").trim()}`;
    else out.push({ ...a });
  }
  return out;
}

/** 페이지 마커 역주입 — 청킹기 tokenize의 <<<PAGE:N>>>이 소비돼 DB엔 page 필드로만 남는다. */
function pushPage(out: string[], a: Art, st: { p: string }) {
  const pg = String(a.page ?? "").trim();
  if (pg && pg !== st.p) { out.push(`<<<PAGE:${pg}>>>`); st.p = pg; }
}

const RM = "Ⅰ-Ⅻⅰ-ⅻ";
/** chunkGanada 역변환 — 장=이름줄, 절=❖줄(청킹기가 소비), 가나다=글자줄, 표지·붙임=본문 그대로. */
function buildGanada(arts: Art[]): string {
  const out: string[] = [];
  const st = { p: "1" };
  for (const a of arts) {
    pushPage(out, a, st);
    const ft = (a.fullText ?? "").trim();
    if (!ft) {
      if (a.name === "붙임") continue;                               // 합성 그룹 구분자 — 원문에 없음
      out.push(/^\d+[.)]\s/.test(a.name) ? `❖${a.name}` : a.name);  // 비로마 절=장 / 로마 장
      continue;
    }
    let m;
    if ((m = a.name.match(new RegExp(`^[${RM}][-\\d]*\\.(\\d+)\\s+(.+)$`)))) {   // 절(중간헤더)
      out.push(`❖${m[1]}. ${m[2]}`);
      if (normText(ft) !== normText(m[2])) out.push(ft);
      continue;
    }
    if ((m = a.name.match(new RegExp(`^(?:[${RM}][-\\d]*\\.)?\\d+\\.([가나다라마바사아자차카타파하])\\s+(.+)$`)))) { // 가나다
      out.push(`${m[1]}. ${m[2]}`);
      if (normText(ft) !== normText(m[2])) out.push(ft);
      continue;
    }
    out.push(ft);                                                     // 표지(byPage)·붙임 부속(머리줄 포함)
  }
  return out.join("\n\n");
}

/** chunkPyeonram 역변환 — 장=이름줄, 절/청킹단위=번호줄(로마 접두 제거), ▣관련 참조줄은 절 머리 앞으로 복귀. */
function buildPyeonram(arts: Art[]): string {
  const out: string[] = [];
  const st = { p: "1" };
  for (const a of arts) {
    pushPage(out, a, st);
    const ft = (a.fullText ?? "").trim();
    if (!ft) { out.push(a.name); continue; }                          // 장(JANG)
    let m;
    if ((m = a.name.match(new RegExp(`^[${RM}][-\\d]*\\.(\\d+)\\.(\\d+)(?:\\s+(.+))?$`)))) {  // 청킹단위 N.M
      out.push(`${m[1]}.${m[2]}${m[3] ? ` ${m[3]}` : ""}`, ft);
      continue;
    }
    if ((m = a.name.match(new RegExp(`^[${RM}][-\\d]*\\.(\\d+)\\s+(.+)$`)))) {   // 절 N. — ▣참조는 원문에서 절 머리 앞줄
      const lines = ft.split("\n");
      const refs: string[] = [];
      while (lines.length && /^▣\s*관련/.test(lines[0].trim())) refs.push(lines.shift()!);
      if (refs.length && lines.length && !lines[0].trim()) lines.shift();
      out.push(...refs, `${m[1]}. ${m[2]}`);
      const rest = lines.join("\n").trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(ft);                                                     // 머리말(표지)
  }
  return out.join("\n\n");
}

/** 조문형 기본 역변환 — 이름이 원문 머리줄인 청크는 이름줄+본문, 합성 이름(표지·부칙·[p.N]·
 *  본문이 자기 머리줄을 이미 품은 별표/붙임 부속)은 본문만, 한줄 "삭제 <날짜>"는 머리줄에 붙인다. */
function buildArticles(arts: Art[]): string {
  const out: string[] = [];
  const st = { p: "1" };
  for (const a of arts) {
    pushPage(out, a, st);
    const ft = (a.fullText ?? "").trim();
    if (!ft) { if (a.name !== "부속서류") out.push(a.name); continue; } // "부속서류" 그룹은 합성 — 원문에 없음
    if (a.name === "표지" || /^\[p\.\d+\]/.test(a.name)) { out.push(ft); continue; }
    if (/^(별표|별지|서식|참고|붙임|별첨|부속서류|양식|부표|부록)/.test(a.name)) { out.push(ft); continue; } // 부속: 원문 마커([별표 N]·(양식N) 등)가 본문 첫 줄
    if (nospace(ft).startsWith(nospace(a.name).slice(0, 20))) { out.push(ft); continue; }   // 부칙류: 본문이 머리줄 포함
    if (/^삭제\s*<[^>]*>\s*$/.test(ft)) { out.push(`${a.name} ${ft}`); continue; }          // 원문에서 같은 줄이던 삭제 마커
    out.push(`${a.name}\n${ft}`);
  }
  return out.join("\n\n");
}

const RULES: { key: string; knob?: string; build: (arts: Art[]) => string }[] = [
  { key: "편람가나다역변환", knob: "편람가나다", build: buildGanada },
  { key: "편람역변환", knob: "편람", build: buildPyeonram },
  { key: "조문형", build: buildArticles },
  { key: "이름줄+본문", build: (arts) => arts.map((a) => { const ft = (a.fullText ?? "").trim(); return ft ? `${a.name}\n${ft}` : a.name; }).join("\n\n") },
  { key: "본문우선", build: (arts) => arts.map((a) => { const ft = (a.fullText ?? "").trim(); if (!ft) return a.name; return bodyCoversHeading(ft, a.name) ? ft : `${a.name}\n${ft}`; }).join("\n\n") },
  { key: "본문만", build: (arts) => arts.map((a) => (a.fullText ?? "").trim() || a.name).join("\n\n") },
];

function sameChunks(db: Art[], out: Art[]): string | null {
  if (db.length !== out.length) {
    let i = 0; while (i < Math.min(db.length, out.length) && db[i].name === out[i].name) i++;
    return `조문 수 ${db.length}≠${out.length} · 이름 분기[${i}] DB"${db[i]?.name ?? "—"}" 재"${out[i]?.name ?? "—"}"`;
  }
  for (let i = 0; i < db.length; i++) {
    if (db[i].name !== out[i].name) return `이름[${i}] "${db[i].name}"≠"${out[i].name}"`;
    if (normText(db[i].fullText) !== normText(out[i].fullText)) return `본문[${i}] ${db[i].name}`;
  }
  return null;
}

async function main() {
  const write = process.argv.includes("--write");
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : "";
  await connectDb();
  const files = fs.readdirSync("data/regulations-2026", { recursive: true }) as string[];
  const mds = files.filter((f) => f.endsWith(".md")).map((f) => path.join("data/regulations-2026", f));

  let ok = 0, changedFiles = 0;
  const fails: string[] = [], unmatched: string[] = [];
  for (const fp of mds) {
    const raw = fs.readFileSync(fp, "utf8");
    const { fm } = parseFm(raw);
    const title = fm["문서명"] || fm["규정명"] || "";
    if (only && !title.includes(only)) continue;
    let d = (await RagRegulationModel.findOne({ title }).lean()) as DbDoc | null;
    if (!d && title.includes("_")) d = (await RagRegulationModel.findOne({ title: title.replace(/_/g, " ") }).lean()) as DbDoc | null;
    if (!d) { unmatched.push(`${path.basename(fp)} (문서명="${title}")`); continue; }
    const arts = d.articles ?? [];
    const merged = mergeSplit(arts);
    const useFm = Object.keys(d.metadata?.origMeta ?? {}).length ? (d.metadata!.origMeta as Record<string, string>) : fm;
    const knob = String(useFm["청킹"] ?? "");
    const rules = RULES.filter((r) => !r.knob || r.knob === knob);

    // 후처리 ① 70자 절단 이름 복원 — 원본 md에서 그 접두로 시작하는 유일한 긴 줄이 있으면 통줄로 교체
    //         ② <개정 …> 단독 줄을 앞 줄에 병합(원문에서 같은 줄이던 마커) — 변형으로 시도
    const rawLong = [...new Set(raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 65 && !l.startsWith("|")))];
    const fixTrunc = (text: string) => text.split("\n").map((l) => {
      const t = l.trim();
      if (t.length < 68 || t.startsWith("|")) return l;
      const cands = rawLong.filter((rl) => rl.startsWith(t) && rl.length > t.length);
      return cands.length === 1 ? cands[0] : l;
    }).join("\n");
    const joinMk = (text: string) => text.replace(/\n\s*(<(?:개정|신설|삭제|전문개정|본조신설|제목개정)[^>\n]*>)\s*(?=\n|$)/g, " $1");

    let done = false;
    let firstDiag = "";
    for (const r of rules) {
      if (done) break;
      for (const post of [(t: string) => t, fixTrunc, joinMk, (t: string) => joinMk(fixTrunc(t))]) {
      const text = `${fmBlock(useFm)}\n${post(r.build(merged))}\n`;
      let out: Art[];
      let score = "";
      try { const res = ingestText(text, { sourceName: path.basename(fp), category: d.category || "지침", isExtracted: false }); out = res.doc.articles as Art[]; score = res.audit.score; }
      catch (e) { if (!firstDiag) firstDiag = `[${r.key}] ingest 예외: ${e instanceof Error ? e.message : e}`; continue; }
      const err = sameChunks(arts, out) ?? (score === "bad" ? "검수 bad" : null);
      if (err) {
        if (!firstDiag) {
          const i = Number((err.match(/\[(\d+)\]/) || [])[1] ?? -1);
          let detail = "";
          if (i >= 0 && arts[i] && out[i]) {
            const A = normText(arts[i].fullText), B = normText(out[i]?.fullText);
            let p = 0; while (p < Math.min(A.length, B.length) && A[p] === B[p]) p++;
            const s = Math.max(0, p - 60);
            detail = `\n      DB…${A.slice(s, p + 60)}\n      재…${B.slice(s, p + 60)}`;
          }
          firstDiag = `[${r.key}] ${err}${detail}`;
        }
        continue;
      }
      done = true; ok++;
      const changed = normText(raw) !== normText(text);
      if (changed) changedFiles++;
      if (changed && write) fs.writeFileSync(fp, text);
      if (changed) console.log(`  ✎ [${r.key}] ${title} (${arts.length}조문${write ? " — 덮어씀" : ""})`);
      break;
      }
    }
    if (!done) fails.push(`${title}: ${firstDiag || "?"}`);
  }
  console.log(`\n라운드트립 통과 ${ok}/${mds.length} · 갱신 대상 ${changedFiles} · DB 미매칭 ${unmatched.length} · 실패 ${fails.length} ${write ? "— 적용 완료" : "(dry-run — --write로 덮어씀)"}`);
  if (unmatched.length) console.log(`미매칭:\n  ${unmatched.join("\n  ")}`);
  if (fails.length) console.log(`실패(파일 유지):\n  ${fails.join("\n  ")}`);
  await mongoose.disconnect();
}
void main();
