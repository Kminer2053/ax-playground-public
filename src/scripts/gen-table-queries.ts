/**
 * 표형 골드셋 확장 질의 자동 생성 — DB의 tableGloss(행 명제)에서 역생성.
 *   MONGODB_URI=... npx tsx src/scripts/gen-table-queries.ts          # 미리보기(파일 미변경)
 *   MONGODB_URI=... npx tsx src/scripts/gen-table-queries.ts --write  # table-queries.json에 append
 *
 * 원칙:
 *  - expectEvidence는 반드시 원문(fullText)에 실재하는 조각만 사용(gloss 아님) — 명제화를 껐을 때(롤백)도
 *    같은 골드셋으로 공정 측정 가능.
 *  - 질의는 원문 어절 그대로가 아니라 변형(한글 금액→아라비아, 구입→구매, 어미 로테이션)을 섞어
 *    문자열 우연 일치가 아닌 '격차 해소 능력'을 검증.
 *  - 문서당 상한으로 특정 문서 도배 방지, 금액 구간 행은 중간값 질의로 구간 산술을 검증.
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";

type Gold = { q: string; cat: string; expectDoc: string[]; expectEvidence: string[]; answer: string; gen?: boolean };

const WRITE = process.argv.includes("--write");
const TARGET = 100;
const PER_DOC_MAX = 20; // 표가 풍부한 핵심 문서(위임전결 등)를 과도하게 자르지 않되 도배는 방지

/** 받침 유무 조사 선택 */
const josa = (w: string, a: string, b: string) => {
  const c = w.charCodeAt(w.length - 1);
  return a && ((c - 0xac00) % 28 > 0 ? a : b);
};

const KOR_NUM: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
function korToManwon(s: string): number | null {
  let rest = s.replace(/원$/, ""); let total = 0;
  const eok = rest.match(/^([일이삼사오육칠팔구]?)억/);
  if (eok) { total += (eok[1] ? KOR_NUM[eok[1]] : 1) * 10000; rest = rest.slice(eok[0].length); }
  if (rest) {
    if (!/만$/.test(rest)) return total || null;
    rest = rest.replace(/만$/, "");
    let man = 0;
    if (/천/.test(rest)) { const m = rest.match(/^([일이삼사오육칠팔구]?)천/); man += (m?.[1] ? KOR_NUM[m[1]] : 1) * 1000; rest = rest.replace(/^[일이삼사오육칠팔구]?천/, ""); }
    if (/백/.test(rest)) { const m = rest.match(/^([일이삼사오육칠팔구]?)백/); man += (m?.[1] ? KOR_NUM[m[1]] : 1) * 100; rest = rest.replace(/^[일이삼사오육칠팔구]?백/, ""); }
    if (/십/.test(rest)) { const m = rest.match(/^([일이삼사오육칠팔구]?)십/); man += (m?.[1] ? KOR_NUM[m[1]] : 1) * 10; rest = rest.replace(/^[일이삼사오육칠팔구]?십/, ""); }
    if (rest && KOR_NUM[rest]) man += KOR_NUM[rest];
    total += man;
  }
  return total || null;
}
const fmtManwon = (v: number) => (v >= 10000 ? `${Math.floor(v / 10000)}억${v % 10000 ? (v % 10000) + "만" : ""}원` : `${v}만원`);

/** 업무 원문 → 질의용 축약(괄호·단서 제거, 42자 컷) */
function shorten(work: string): string {
  let s = work.replace(/\([^)]*\)/g, "").replace(/[※•◦]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[,，(（/／].*$/, "").trim(); // 미완 괄호·슬래시 이후 절단(질의 노이즈 방지)
  if (s.length > 42) s = s.slice(0, 42).replace(/\s+\S*$/, "");
  return s;
}

/** evidence 후보: 원문에 실재하는 조각(공백 정규화 비교). 통째 실패 시 쉼표·괄호 분해 조각 중 최장(≥10자) 시도 */
function pickEvidence(fullNorm: string, cand: string): string | null {
  const ok = (s: string) => { const c = s.replace(/\s+/g, ""); return c.length >= 8 && fullNorm.includes(c); };
  if (ok(cand)) return cand;
  const parts = cand.split(/[,，()（）]/).map((s) => s.trim()).filter((s) => s.replace(/\s+/g, "").length >= 10).sort((a, b) => b.length - a.length);
  for (const p of parts) if (ok(p)) return p;
  return null;
}

async function main() {
  await connectDb();
  const col = mongoose.connection.db!.collection(collectionName("ragRegulation"));
  const docs = await col.find({ "articles.tableGloss": { $exists: true } }, { projection: { title: 1, articles: 1 } }).toArray();

  const endings: ((w: string) => string)[] = [
    (w) => `${w}${josa(w, "은", "는")} 누가 전결하나요?`,
    (w) => `${w} 전결권자가 누구인가요?`,
    (w) => `${w}${josa(w, "은", "는")} 어느 선까지 결재해야 하나요?`,
    (w) => `${w} 결재권자를 알려주세요.`,
    (w) => `${w}${josa(w, "은", "는")} 누구 전결 사항인가요?`,
  ];
  const out: Gold[] = [];
  const perDoc = new Map<string, number>();
  const seenQ = new Set<string>();

  const push = (g: Gold): boolean => {
    const k = g.q.replace(/\s+/g, "");
    if (seenQ.has(k)) return false;
    const n = perDoc.get(g.expectDoc[0]) ?? 0;
    if (n >= PER_DOC_MAX) return false;
    seenQ.add(k); perDoc.set(g.expectDoc[0], n + 1);
    out.push({ ...g, gen: true });
    return true;
  };

  let ei = 0;
  for (const d of docs) {
    const title = d.title as string;
    for (const a of d.articles as { name: string; fullText?: string; tableGloss?: string }[]) {
      if (!a.tableGloss) continue;
      const fullNorm = (a.fullText ?? "").replace(/\s+/g, "");
      for (const line of a.tableGloss.split("\n")) {
        // ── 전결형: "- [범위] 업무 → 직급 전결 (금액: …)"
        let m = line.match(/^- (?:\[([^\]]+)\] )?(.+?) → (.+?) 전결/);
        if (m) {
          const [, scope, work, rank] = m;
          const short = shorten(work);
          const ev = pickEvidence(fullNorm, work.length <= 46 ? work : short);
          if (!ev || short.length < 6) continue;
          // 금액 구간 행 → 중간값 아라비아 질의(구간 산술 검증) + 일반 업무형 질의
          const range = work.match(/([일이삼사오육칠팔구억천백십만]+원)\s*(초과|이상)\s*([일이삼사오육칠팔구억천백십만]+원)\s*(이하|미만)/);
          const scopeTag = scope ? `[${scope}] ` : "";
          const mk = (q: string) =>
            push({ q: q.replace(/구입/g, "구매"), cat: "전결", expectDoc: [title], expectEvidence: [ev], answer: `${scopeTag}${rank} 전결 — ${title} ${a.name}` });
          if (range) {
            const lo = korToManwon(range[1]); const hi = korToManwon(range[3]);
            if (lo && hi && hi > lo) {
              const mid = Math.round((lo + hi) / 2 / 10) * 10 || lo + 1;
              const noun = short.replace(/^.*(이하|미만|초과|이상)의?\s*/, "") || short;
              mk(`${fmtManwon(mid)}짜리 ${noun}${josa(noun, "은", "는")} 누가 전결하나요?`);
            }
          }
          mk(endings[ei++ % endings.length](short));
          continue;
        }
        // ── 양정형: "- 유형: 단계 → 처분; …" (파면·해임 등 포함 시)
        m = line.match(/^- ([^:]{6,60}): (.+)$/);
        if (m && /파면|해임|정직|감봉|견책/.test(m[2])) {
          const label = m[1].replace(/^[가-힣]\.\s*/, "").trim();
          const ev = pickEvidence(fullNorm, label);
          if (!ev) continue;
          const q = `${shorten(label)}의 경우 징계양정 기준이 어떻게 되나요?`;
          push({ q, cat: "징계양정", expectDoc: [title], expectEvidence: [ev], answer: `${title} ${a.name} 해당 행 참조` });
          continue;
        }
        // ── 매핑형: "- 라벨: k=v, …" (조문 참조·항목기호 노이즈 제외)
        if (m) {
          const label = m[1].replace(/^[가-힣]\.\s*/, "").replace(/^[◦○●▸-]\s*/, "").trim();
          if (label.length < 8 || /^\d|^제?\s*\d+조|^별표|^별지|^구\s*분/.test(label)) continue;
          const ev = pickEvidence(fullNorm, label);
          if (!ev) continue;
          const shortLabel = shorten(label);
          if (shortLabel.length < 8) continue; // 절단 후 빈약 라벨("일반상품" 등)은 검증력 없음
          const q = `${shortLabel} 기준이 어떻게 되나요?`;
          push({ q, cat: "기준표", expectDoc: [title], expectEvidence: [ev], answer: `${title} ${a.name} 해당 행 참조` });
        }
      }
    }
  }

  // 카테고리 균형 선별: 전결 40 · 징계양정 20 · 기준표 40 (부족분은 다른 유형으로 채움)
  const byCat = (c: string) => out.filter((g) => g.cat === c);
  const quota: [string, number][] = [["전결", 40], ["징계양정", 20], ["기준표", 40]];
  const picked: Gold[] = [];
  for (const [c, n] of quota) picked.push(...byCat(c).slice(0, n));
  for (const g of out) { if (picked.length >= TARGET) break; if (!picked.includes(g)) picked.push(g); }
  const final = picked.slice(0, TARGET);

  console.log(`후보 ${out.length} → 선별 ${final.length} (전결 ${final.filter((g) => g.cat === "전결").length} · 징계 ${final.filter((g) => g.cat === "징계양정").length} · 기준표 ${final.filter((g) => g.cat === "기준표").length}) · 문서 ${new Set(final.map((g) => g.expectDoc[0])).size}종`);
  console.log("\n샘플 6건:");
  for (const g of final.filter((_, i) => i % Math.ceil(final.length / 6) === 0).slice(0, 6)) console.log(`  [${g.cat}] ${g.q}\n     └ ev: ${g.expectEvidence[0].slice(0, 50)} (${g.expectDoc[0]})`);

  if (WRITE) {
    const p = path.join(process.cwd(), "data/benchmark/table-queries.json");
    const cur = JSON.parse(fs.readFileSync(p, "utf8")) as Gold[];
    const kept = cur.filter((g) => !g.gen); // 수동 22문항 보존, 기존 생성분은 교체
    fs.writeFileSync(p, JSON.stringify([...kept, ...final], null, 1));
    console.log(`\n✔ 저장: 수동 ${kept.length} + 생성 ${final.length} = ${kept.length + final.length}문항 → ${p}`);
  } else {
    console.log("\n(저장하려면 --write)");
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
