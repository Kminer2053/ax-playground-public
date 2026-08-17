import mongoose from "mongoose";
import { articleHash } from "@/lib/article-hash";
import { RagRegulationModel } from "@/models/RagRegulation";
import { getEmbedding, EMBEDDING_INPUT_MAX_CHARS } from "./embedding";
import { chatLlm } from "./llm";
import { getPlaygroundConfig } from "./playgroundConfig";
import { clearVectorCache } from "./regulations-vector";
import { classifyRelType, classifyRelTypeForTarget } from "./regulations-rel-classify";
import { collectionName } from "@/lib/collections";

/**
 * 증분 그래프 빌드 — 한 문서만 재임베딩 + 참조 엣지 재검증(로컬 LLM). 관리자 사규 추가·수정 시 호출.
 * 전체 재빌드(data/graph 파이프라인)와 동일 규칙·스키마를 1개 문서 범위로 수행.
 */
const LAWS = ["국가를당사자로하는계약에관한법률","국가계약법","지방계약법","전자조달의이용및촉진에관한법률","조달사업에관한법률","하도급거래공정화에관한법률","부정청탁및금품등수수의금지","중소기업제품구매촉진","개인정보보호법","근로기준법","남녀고용평등","산업안전보건법","공공기관의운영에관한법률"];
const nospace = (s: string) => s.replace(/\s+/g, "");
const jonum = (name: string): number | null => { const m = name.match(/제\s*(\d+)\s*조/); return m ? Number(m[1]) : null; };
const snip = (t: string, idx: number, len: number, w = 130) => t.slice(Math.max(0, idx - w), idx + len + w).replace(/\n/g, " ");

type Art = { name: string; fullText?: string };
type Cand = {
  sci: number; sname: string;
  type: "내부조문" | "별표" | "별지" | "외부규정" | "외부법령";
  tci?: number; tname?: string; tdoc?: string; tgt: string; snip: string;
};

/** 한 문서의 참조 후보 추출(전체 파이프라인 extract_all.py 규칙의 TS 포팅).
 *  opts.hierParent: 위계 모문서 — 시행세칙류의 "동 규정 제N조"·무접두 "규정 제N조"(실측 43회)는
 *  본문 앞 언급이 아니라 모규정을 가리키는 관용 표현이라 hier 부모로 해석한다. */
export function extractCandidatesForDoc(arts: Art[], selfTitle: string, otherTitles: string[], opts?: { hierParent?: string; internalKeys?: Set<string> }): Cand[] {
  const joIdx: Record<number, number> = {};
  const bypIdx: Record<number, number[]> = {};
  const byjIdx: Record<number, number[]> = {};
  arts.forEach((a, i) => {
    const n = a.name || "";
    const j = jonum(n);
    if (j && n.includes("(")) joIdx[j] = i;
    const mb = n.match(/^별표\s*제(\d+)호(?!\s*별지)/);
    if (mb) (bypIdx[Number(mb[1])] ||= []).push(i);
    const mj = n.match(/^별지\s*제(\d+)호/);
    if (mj) (byjIdx[Number(mj[1])] ||= []).push(i);
  });
  const len = (i: number) => (arts[i]?.fullText || "").length;
  const pick = (idxs?: number[]) => (idxs && idxs.length ? idxs.reduce((a, b) => (len(b) > len(a) ? b : a)) : undefined);
  const dockey = otherTitles.filter((t) => t !== selfTitle && nospace(t).length >= 4).map((t) => [nospace(t), t] as const);
  const titleByKey = new Map(otherTitles.filter((t) => t !== selfTitle).map((t) => [nospace(t), t] as const));
  // 4자 미만 제목(정관·민법·상법·형법 등)은 부분 문자열 매칭이 위험해("행정관리"⊃"정관") 제외돼
  // 왔지만, 그 탓에 정관 8회·민법 14회 등 실참조 34회가 그래프에서 통째로 빠졌다(실측).
  // 낫표 인용(「정관」) 또는 "정관 제N조"처럼 명시적 참조 꼴일 때만 잡는다(+ 앞글자 한글 금지).
  const shortkey = otherTitles
    .filter((t) => t !== selfTitle && nospace(t).length >= 2 && nospace(t).length < 4)
    .map((t) => {
      const flex = [...nospace(t)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
      return [new RegExp(`「\\s*${flex}\\s*」|(?<![가-힣])${flex}\\s*제\\s*\\d+\\s*조`), t] as const;
    });
  // 짧은 법령명(민법·상법 등 적재 법령)의 조번호 없는 맨언급("민법상 위임계약") — 법령 후보는
  // LLM 게이트를 안 타므로 룩비하인드로만 방어("형사상법률"의 상법 등 합성어 차단).
  const shortLaws = opts?.internalKeys
    ? otherTitles.filter((t) => t !== selfTitle && nospace(t).length >= 2 && nospace(t).length < 4 && !opts.internalKeys!.has(nospace(t)))
    : [];
  // "동 규정"이 모규정을 가리키려면: 부모가 규정이고, 자신은 규정이 아니어야(규정 안의 "동 규정"=자기 자신).
  const parent = opts?.hierParent && opts.hierParent !== selfTitle
    && /규\s*정$/.test(opts.hierParent) && !/규정$/.test(nospace(selfTitle))
    ? opts.hierParent : undefined;

  const out: Cand[] = [];
  arts.forEach((a, src) => {
    const t = (a.fullText || "").trim();
    if (!t) return;
    const selfjo = jonum(a.name || "");
    const seen = new Set<string>();
    // 내부 조 / 외부법령 조 / 모규정 조
    for (const m of t.matchAll(/(.{0,14})제\s*(\d+)\s*조(?:의\s*\d+)?/g)) {
      const pre = m[1]; const j = Number(m[2]);
      if (j === selfjo) continue;
      // "동 규정 제N조"·무접두 "규정 제N조"(시행세칙 관용) → 위계 모규정. 자기 조번호로
      // 오귀속되기 전에 가로챈다("동 규정 제47조"가 세칙 자신의 제47조에 붙던 경로).
      if (parent && /(?:^|[^가-힣])(?:동\s*)?규\s*정\s*$/.test(pre)) {
        const k = `doc${parent}`;   // 제목 매칭과 같은 키 — 한 조문에서 같은 문서로 후보가 중복되지 않게
        if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "외부규정", tdoc: parent, tgt: parent, snip: snip(t, m.index ?? 0, m[0].length) }); }
        continue;
      }
      if (/(시행령|시행규칙|」|｣|』|법률|법|령|예규|기준|규칙|고시)\s*$/.test(pre)) {
        let law = pre.includes("시행령") ? "국가계약법 시행령" : pre.includes("시행규칙") ? "국가계약법 시행규칙" : "외부법령";
        const mm = pre.match(/[「｢『]([^」｣』]{2,30})[」｣』]\s*$/); if (mm) law = mm[1];
        // 낫표 인용이 실은 "내부 사규" 제목이면 법령이 아니다 — 자기 자신이면 건너뛰고, 타 사규면
        // 문서 참조로. DB에 적재된 법령 문서 제목은 여기서 빼야 한다(law 엣지가 정답 —
        // 실수로 전환했더니 law 844→689로 무너져 되돌린 이력).
        const asDoc = titleByKey.get(nospace(law));
        if (nospace(law) === nospace(selfTitle)) continue;
        if (asDoc && opts?.internalKeys?.has(nospace(asDoc))) {
          const k = `doc${asDoc}`;
          if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "외부규정", tdoc: asDoc, tgt: asDoc, snip: snip(t, m.index ?? 0, m[0].length) }); }
          continue;
        }
        const k = `law${law}${j}`; if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "외부법령", tgt: `${law} 제${j}조`, snip: snip(t, m.index ?? 0, m[0].length) }); }
        continue;
      }
      const tgt = joIdx[j];
      if (tgt != null) { const k = `jo${tgt}`; if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "내부조문", tci: tgt, tname: arts[tgt].name, tgt: arts[tgt].name, snip: snip(t, m.index ?? 0, m[0].length) }); } }
    }
    for (const m of t.matchAll(/별표\s*제?\s*(\d+)\s*호/g)) {
      const tgt = pick(bypIdx[Number(m[1])]);
      if (tgt != null && tgt !== src) { const k = `byp${tgt}`; if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "별표", tci: tgt, tname: arts[tgt].name, tgt: arts[tgt].name, snip: snip(t, m.index ?? 0, m[0].length) }); } }
    }
    for (const m of t.matchAll(/별지\s*제?\s*(\d+)\s*호\s*서식/g)) {
      const tgt = pick(byjIdx[Number(m[1])]);
      if (tgt != null && tgt !== src) { const k = `byj${tgt}`; if (!seen.has(k)) { seen.add(k); out.push({ sci: src, sname: a.name, type: "별지", tci: tgt, tname: arts[tgt].name, tgt: arts[tgt].name, snip: snip(t, m.index ?? 0, m[0].length) }); } }
    }
    const tn = nospace(t);
    // 외부규정 문서명 매칭 — 최장 일치 우선. "급여규정"이 "급여규정시행세칙"의 일부로만
    // 나타나면 짧은 제목은 오탐이다(실측: 이 오탐 엣지 17건이 DB에 있었다). 매치 구간을 모아
    // 짧은 제목의 모든 출현이 더 긴 제목의 출현 안에 포함되면 버린다.
    const matched: { k: string; full: string; ranges: [number, number][] }[] = [];
    for (const [k, full] of dockey) {
      if (!tn.includes(k)) continue;
      const ranges: [number, number][] = [];
      for (let p = tn.indexOf(k); p >= 0; p = tn.indexOf(k, p + 1)) ranges.push([p, p + k.length]);
      matched.push({ k, full, ranges });
    }
    // 자기 제목의 출현 구간도 억제자다 — "철도구내영업 규정" 본문이 제 이름을 부르면 그 안의
    // "영업규정"(별개 문서)이 걸리면 안 된다. 자기 제목은 후보가 아니라서 최장 일치만으론 못 막는다.
    const selfKey = nospace(selfTitle);
    const selfRanges: [number, number][] = [];
    if (selfKey.length >= 2) for (let p = tn.indexOf(selfKey); p >= 0; p = tn.indexOf(selfKey, p + 1)) selfRanges.push([p, p + selfKey.length]);
    for (const m of matched) {
      const freeOccurrence = m.ranges.some((r) =>
        !(selfKey.length > m.k.length && selfKey.includes(m.k)
          && selfRanges.some(([s2, e2]) => s2 <= r[0] && r[1] <= e2))
        && !matched.some((o) => o !== m && o.k.length > m.k.length && o.k.includes(m.k)
          && o.ranges.some(([s2, e2]) => s2 <= r[0] && r[1] <= e2)));
      if (!freeOccurrence || seen.has(`doc${m.full}`)) continue;
      seen.add(`doc${m.full}`);
      const re = new RegExp([...m.k].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"));
      const mm = re.exec(t);
      out.push({ sci: src, sname: a.name, type: "외부규정", tdoc: m.full, tgt: m.full, snip: mm ? snip(t, mm.index, mm[0].length) : m.full });
    }
    for (const law of LAWS) if (tn.includes(law) && !seen.has(`law2${law}`)) { seen.add(`law2${law}`); out.push({ sci: src, sname: a.name, type: "외부법령", tgt: law, snip: law }); }
    // 짧은 법령명 맨언급 — 조번호 동반이면 shortkey(문서 참조) 몫이라 중복 생성하지 않는다
    for (const law of shortLaws) {
      const k = nospace(law);
      if (seen.has(`law2${k}`) || new RegExp(`${k}\\s*제\\s*\\d+\\s*조`).test(t)) continue;
      const mm = new RegExp(`(?<![가-힣])${k}`).exec(t);
      if (mm) { seen.add(`law2${k}`); out.push({ sci: src, sname: a.name, type: "외부법령", tgt: law, snip: snip(t, mm.index, k.length) }); }
    }
    // 짧은 제목 — 명시적 참조 꼴(낫표·제N조 동반)만
    for (const [re, full] of shortkey) {
      const mm = re.exec(t);
      if (mm && !seen.has(`doc${full}`)) { seen.add(`doc${full}`); out.push({ sci: src, sname: a.name, type: "외부규정", tdoc: full, tgt: full, snip: snip(t, mm.index, mm[0].length) }); }
    }
    // 조번호 없는 단독 "동 규정"(…에 따른다 등) → 모규정 문서 참조
    if (parent && !seen.has(`doc${parent}`)) {
      const mm = /(?:^|[^가-힣])동\s*규\s*정(?!\s*제\s*\d)/.exec(t);
      if (mm) { seen.add(`doc${parent}`); out.push({ sci: src, sname: a.name, type: "외부규정", tdoc: parent, tgt: parent, snip: snip(t, mm.index, mm[0].length) }); }
    }
  });
  return out;
}

const RT_SET = new Set(["근거", "준용적용", "서식첨부", "정의", "위임", "예외", "절차", "기타"]);
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/**
 * LLM 출력 관대 파싱 — 소형모델(gemma-2B)이 형식을 자주 어겨(대괄호 [1]:·원문자 ①·파이프 |·엉뚱한 유형)
 * 정규식이 못 잡고 조용히 폴백하던 문제 방지. 번호·판정만 견고히 뽑고 유형은 표준집합만 채택.
 */
function parseVerdicts(out: string, n: number): Map<number, { real: boolean; rt: string }> {
  const text = out.replace(/[①-⑳]/g, (c) => `${CIRCLED.indexOf(c) + 1}:`); // 원문자 → "번호:"
  const res = new Map<number, { real: boolean; rt: string }>();
  // [n]/n, 구분자 :：|｜, 판정 Y/N·참/거짓·yes/no·예/아니오, 유형(선택)
  const re = /\[?\s*(\d{1,3})\s*\]?\s*[:：|｜]+\s*(Y|N|참|거짓|yes|no|예|아니(?:오|요))\b\s*[:：|｜]*\s*([가-힣·]{2,})?/gi;
  for (const m of text.matchAll(re)) {
    const k = Number(m[1]) - 1;
    if (k < 0 || k >= n || res.has(k)) continue;
    const yn = m[2].toUpperCase();
    const real = yn === "Y" || yn === "참" || yn === "YES" || yn === "예";
    res.set(k, { real, rt: m[3] && RT_SET.has(m[3]) ? m[3] : "기타" });
  }
  return res;
}

/** 로컬 LLM(gemma)로 후보 검증 — is_real + 관계유형. 외부법령은 LLM 생략(외부 포인터로 유지).
 *  fallback=형식오류·호출실패로 기본값 처리된 건수(품질저하 신호), fbIdx=폴백된 후보 인덱스 —
 *  폴백 결과는 "판정"이 아니라 임시값이므로 호출측이 해시 박제에서 제외해 다음 적재 때 재판정되게 한다. */
async function verifyWithLlm(selfTitle: string, cands: Cand[]): Promise<{ verdicts: Map<number, { real: boolean; rt: string }>; fallback: number; fbIdx: Set<number> }> {
  const res = new Map<number, { real: boolean; rt: string }>();
  const fbIdx = new Set<number>();
  let fallback = 0;
  const fb = (x: { c: Cand; i: number }) => { res.set(x.i, { real: x.c.type !== "내부조문", rt: "기타" }); fbIdx.add(x.i); fallback++; }; // 보수적: 별표/별지/외부규정 유지, 내부조문 제외
  const targets = cands.map((c, i) => ({ c, i })).filter((x) => x.c.type !== "외부법령");
  const BATCH = 15;
  for (let b = 0; b < targets.length; b += BATCH) {
    const slice = targets.slice(b, b + BATCH);
    const lines = slice.map((x, k) => `[${k + 1}] (${x.c.type}) ${x.c.sname} → ${x.c.tgt} | 맥락: ${x.c.snip.slice(0, 320)}`).join("\n");
    const prompt =
      `사규 "${selfTitle}"에서 추출한 참조 후보들이다. 각 후보가 '실제 상호참조'인지 판정하라.\n` +
      `거짓(N): 숫자가 실은 시행령·법률·예규 등 외부법령 조항을 가리키거나(내부조문 오인), 단순 언급일 뿐 참조가 아니거나, 대상이 잘못 매칭된 경우.\n` +
      `참(Y): "…에 따라/준용/불구하고/참조/첨부/별표와 같다/별지 서식에 따라" 등 실제 참조.\n` +
      `출력 형식(엄수): 한 줄에 하나씩 "번호:판정:유형" — 판정은 Y 또는 N, 유형=근거|준용적용|서식첨부|정의|위임|예외|절차|기타.\n` +
      `예) 1:Y:준용적용 / 2:N:기타 — 대괄호·원문자·파이프·설명 금지.\n\n${lines}`;
    let out = "";
    try {
      out = await chatLlm([{ role: "user", content: prompt }], { maxTokens: 700, temperature: 0 });
    } catch {
      for (const x of slice) fb(x); // 호출 실패 → 전체 폴백
      continue;
    }
    const parsed = parseVerdicts(out, slice.length);
    slice.forEach((x, k) => { const p = parsed.get(k); if (p) res.set(x.i, p); else fb(x); }); // 파싱 누락분만 폴백
  }
  if (fallback) console.warn(`[graph] verifyWithLlm 폴백 ${fallback}/${targets.length}건 — LLM 형식오류/실패(그래프 품질 저하 가능)`);
  return { verdicts: res, fallback, fbIdx };
}

/** 문서 삭제 시 그래프·벡터 정리(나가는/들어오는 엣지 + 벡터 모두). */
export async function removeGraphForDoc(title: string): Promise<void> {
  const db = mongoose.connection?.db;
  if (!db) return;
  await Promise.all([
    db.collection(collectionName("ragVectors")).deleteMany({ doc: title }),
    db.collection(collectionName("ragGraphEdges")).deleteMany({ $or: [{ sdoc: title }, { tdoc: title }] }),
  ]);
  clearVectorCache();
}

/** 문서 1건의 임베딩·그래프 엣지를 증분 갱신. directParent 지정 시 위계 엣지도 upsert. */
export async function updateGraphForDoc(title: string, directParent?: string): Promise<{ vectors: number; refEdges: number; lawEdges: number; reused: number; edgeReused: number; llmFallback: number; embedFailed: number; embedTruncated: number }> {
  const db = mongoose.connection?.db;
  if (!db) throw new Error("no db");
  const cfg = await getPlaygroundConfig();
  const doc = (await RagRegulationModel.findOne({ title }, { title: 1, category: 1, articles: 1 }).lean()) as
    | { title?: string; category?: string; articles?: Art[] } | null;
  if (!doc) throw new Error(`문서 없음: ${title}`);
  const arts = doc.articles ?? [];
  const allDocsLean = (await RagRegulationModel.find({}, { title: 1, category: 1 }).lean()) as { title?: string; category?: string }[];
  const allTitles = allDocsLean.map((d) => String(d.title || ""));
  const internalKeys = new Set(allDocsLean.filter((d) => !["법령", "행정규칙"].includes(String(d.category || ""))).map((d) => String(d.title || "").replace(/\s+/g, "")));
  const lawTitleByKey = new Map(allDocsLean.filter((d) => ["법령", "행정규칙"].includes(String(d.category || ""))).map((d) => [String(d.title || "").replace(/\s+/g, ""), String(d.title || "")]));

  // 1) 재임베딩 (rag_vectors) — 변경 안 된 조문(이름+본문 해시 동일)은 기존 임베딩 재사용(재계산 skip).
  //    인덱스(ci)는 전체를 새로 재색인해 그래프 엣지(sci/tci)와 정합 유지 → "변경분만 재계산 + 전체 재색인".
  const vcol = db.collection(collectionName("ragVectors"));
  // 해시 규약은 article-hash.ts 한 곳에만 둔다(P0). 여기 입력은 이미 정규화된 본문이라 결과는 동일하다.
  const hashOf = (name: string, body: string) => articleHash(name, body);
  const prevVecs = (await vcol.find({ doc: title }, { projection: { name: 1, h: 1, vec: 1, m: 1 } }).toArray()) as { name?: string; h?: string; vec?: number[]; m?: string }[];
  const prevByName = new Map(prevVecs.filter((v) => v.name && v.h && Array.isArray(v.vec)).map((v) => [v.name as string, v]));
  const vrows: { doc: string; ci: number; name: string; cat: string; vec: number[]; h: string; m: string }[] = [];
  const embedModelId = String(cfg.embedModel || "").trim();   // 벡터에 생성 모델을 새겨 모델 교체를 감지 가능하게
  let reused = 0, embedFailed = 0, embedTruncated = 0;
  if (cfg.ragVectorEnabled) {
    for (let i = 0; i < arts.length; i++) {
      const norm = (arts[i].fullText || "").replace(/\s+/g, " ").trim();
      if (!norm) continue;
      // 입력 상한 초과 조문은 잘린 채 임베딩된다(뒷부분이 벡터 검색에서 안 보임) — 최소한 세어서 알린다.
      if (`${arts[i].name}\n${arts[i].fullText || ""}`.length > EMBEDDING_INPUT_MAX_CHARS) embedTruncated++;
      const h = hashOf(arts[i].name, norm);
      const prev = prevByName.get(arts[i].name);
      // 재사용 조건에 모델 일치 추가 — 임베딩 모델을 바꾸면 옛 모델 벡터와 새 모델 벡터가 한
      // 공간에 섞여 유사도가 무의미해진다. 모델이 다르면(기록이 있을 때만 비교) 재계산.
      const sameModel = !prev?.m || !embedModelId || prev.m === embedModelId;
      let vec: number[] | null =
        prev && sameModel && prev.h === h && prev.vec!.length === (cfg.embedDims || prev.vec!.length) ? prev.vec! : null;
      if (vec) { reused++; vrows.push({ doc: title, ci: i, name: arts[i].name, cat: doc.category || "", vec, h, m: prev!.m || "" }); continue; } // 무라벨 벡터에 현재 모델명을 날조하지 않는다 — 출처 불명은 불명으로
      vec = await getEmbedding(`${arts[i].name}\n${arts[i].fullText || ""}`, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      if (vec) { vrows.push({ doc: title, ci: i, name: arts[i].name, cat: doc.category || "", vec, h, m: embedModelId }); continue; }
      // 임베딩 실패 — 옛 벡터라도 남긴다(옛 해시 그대로 두어 다음 성공 적재 때 다시 계산되게).
      // 예전엔 여기서 그냥 건너뛰어, 지우기가 이미 끝난 뒤라 벡터가 통째로 사라졌다.
      embedFailed++;
      // 보존은 차원이 지금 설정과 같을 때만 — 차원이 다른 옛 벡터가 섞이면 벡터 검색 전체가
      // NaN으로 오염된다(loadVectors는 단일 차원 전제). 다르면 그냥 비워 두는 편이 안전.
      if (prev?.vec && (!cfg.embedDims || prev.vec.length === cfg.embedDims)) vrows.push({ doc: title, ci: i, name: arts[i].name, cat: doc.category || "", vec: prev.vec, h: prev.h || "", m: prev.m || "" });
    }
    // 새 목록이 준비된 뒤에 교체한다(먼저 지우면 실패 시 복구할 것이 없다).
    await vcol.deleteMany({ doc: title });
    if (vrows.length) await vcol.insertMany(vrows);
    clearVectorCache();
    if (embedFailed) console.warn(`[graph-build] "${title}" 임베딩 실패 ${embedFailed}건 — 옛 벡터 유지(서버 확인 후 재적재 필요)`);
    if (embedTruncated) console.warn(`[graph-build] "${title}" 입력 상한(${EMBEDDING_INPUT_MAX_CHARS}자) 초과 조문 ${embedTruncated}건 — 절단 임베딩(뒷부분 벡터검색 미노출)`);
  }

  // 2) 참조/법령 엣지 — 변경 안 된 조문은 옛 엣지(검증결과)를 인덱스만 재매핑해 재사용(추출·LLM skip),
  //    변경/추가 조문만 재추출 + LLM 재검증. srcHash(조문 본문 해시)로 변경 판정 → LLM 비용을 변경분만으로 절감.
  const ecol = db.collection(collectionName("ragGraphEdges"));
  const oldEdges = (await ecol.find({ sdoc: title, kind: { $in: ["ref", "law"] } }).toArray()) as Record<string, unknown>[];
  await ecol.deleteMany({ sdoc: title, kind: { $in: ["ref", "law"] } });

  const nameToIdx = new Map<string, number>();
  arts.forEach((a, i) => { if (a.name && !nameToIdx.has(a.name)) nameToIdx.set(a.name, i); });
  const artHash = arts.map((a) => hashOf(a.name, (a.fullText || "").replace(/\s+/g, " ").trim()));
  const oldBySname = new Map<string, { srcHash: string; hasFb: boolean; edges: Record<string, unknown>[] }>();
  for (const e of oldEdges) {
    const sn = String(e.sname || ""); if (!sn) continue;
    const g = oldBySname.get(sn) ?? { srcHash: String(e.srcHash || ""), hasFb: false, edges: [] };
    if (e.fb) g.hasFb = true; // 폴백 임시 판정이 섞인 조문 — 재사용 금지, 반드시 재판정
    g.edges.push(e); oldBySname.set(sn, g);
  }

  // '엣지 0개' 조문의 무변경 판정용 해시 박제 — 엣지가 없으면 srcHash를 얹을 곳이 없어
  // 재적재 때마다 재도출(gemma)되어 그래프가 점증 드리프트하던 문제 방지(kind:"arthash" 메타 1건/문서).
  const prevHashMeta = (await ecol.findOne({ kind: "arthash", sdoc: title })) as { hashes?: string[] } | null;
  const prevNoEdgeHashes = new Set(prevHashMeta?.hashes ?? []);

  const edgeDocs: Record<string, unknown>[] = [];
  const changedIdx = new Set<number>();
  let edgeReused = 0;
  arts.forEach((a, i) => {
    const old = a.name ? oldBySname.get(a.name) : undefined;
    const unchanged = !!(old && !old.hasFb && old.srcHash && old.srcHash === artHash[i]);
    // 재사용 조건: 조문 본문 무변경 + 참조하던 대상 조문이 모두 현존(개명·삭제 시엔 재도출로 정확 반영)
    const targetsOk = unchanged && old!.edges.every((e) => !(e.kind === "ref" && e.tt === "chunk") || (e.tname != null && nameToIdx.has(String(e.tname))));
    if (unchanged && targetsOk) {
      for (const e of old!.edges) {
        const ne: Record<string, unknown> = { ...e, sci: i, srcHash: artHash[i] };
        delete ne._id;
        if (e.kind === "ref" && e.tt === "chunk") { ne.tci = nameToIdx.get(String(e.tname)); ne.tdoc = title; }
        edgeDocs.push(ne); edgeReused++;
      }
    } else if (!old && prevNoEdgeHashes.has(artHash[i])) {
      // 이전에도 '엣지 없음'으로 확정된 무변경 조문 → 재도출 skip(빈 결과 재사용)
    } else {
      changedIdx.add(i); // 변경/추가/대상소실 → 재추출·재검증 대상
    }
  });

  // 위계 모문서 — "동 규정"·무접두 "규정 제N조" 해석용(hier 엣지는 ref/law 삭제에 안 지워져 조회 가능)
  const hierEdge = (await ecol.findOne({ kind: "hier", sdoc: title }, { projection: { tdoc: 1 } })) as { tdoc?: string } | null;
  const hierParent = (directParent && directParent.trim()) || (hierEdge?.tdoc ? String(hierEdge.tdoc) : undefined);
  const cands = extractCandidatesForDoc(arts, title, allTitles, { hierParent, internalKeys }).filter((c) => changedIdx.has(c.sci));
  const { verdicts, fallback: llmFallback, fbIdx } = await verifyWithLlm(title, cands);
  // 폴백이 스친 조문(sci) — 이 조문들의 결과는 "판정"이 아니라 임시값이다. 엣지에 fb 표식을 남기고
  // 해시 박제(srcHash 재사용·arthash)에서 제외해, LLM이 살아난 다음 적재 때 반드시 재판정되게 한다.
  // (예전엔 폴백 결과가 그대로 박제돼 어떤 재적재로도 복구되지 않았다.)
  const fbSci = new Set<number>();
  cands.forEach((c, i) => { if (fbIdx.has(i)) fbSci.add(c.sci); });
  // 법령 정제 파이프라인 산출 보강값 — 재도출이 재현할 수 없는 큐레이션이라 승계하지 않으면
  // 재적재 한 번에 벗겨져 3D 법령 링·법령 집계에서 조용히 탈락한다(백필 812건 실사고).
  const LAW_ENRICH_KEYS = ["lawName", "lawNameOrig", "lawDoc", "lawFix", "lawConf", "lawEvidence", "lawMisclass", "rt", "rt_old", "tgt_old", "reason", "rtConf"] as const;
  cands.forEach((c, i) => {
    const fb = fbSci.has(c.sci);
    const srcHash = fb ? undefined : artHash[c.sci];   // 폴백 조문은 해시 미기록 → 다음 적재 때 무변경 재사용 불가
    const prevOf = (pred: (e: Record<string, unknown>) => boolean) => oldBySname.get(c.sname)?.edges.find(pred);
    if (c.type === "외부법령") {
      const prev = prevOf((e) => e.kind === "law" && String(e.tgt) === c.tgt);
      const keep: Record<string, unknown> = {};
      if (prev) for (const k of LAW_ENRICH_KEYS) if (prev[k] !== undefined) keep[k] = prev[k];
      if (keep.rt === undefined || keep.rt === "") { const cls = classifyRelType(c.snip); keep.rt = cls.rt; keep.rtConf = cls.conf; }
      if (keep.lawName === undefined) {
        // 승계할 기존 보강이 없는 신규 엣지 — 정식명 그대로면 결정적으로 문서 연결(표기변형·약칭은 normalize-law-edges 몫)
        const base = String(c.tgt || "").replace(/\s*제\s*\d+\s*조.*$/, "").trim();
        const hit = base && base !== "외부법령" ? lawTitleByKey.get(base.replace(/\s+/g, "")) : undefined;
        if (hit) { keep.lawName = hit; keep.lawDoc = hit; }
      }
      edgeDocs.push({ kind: "law", sdoc: title, sci: c.sci, sname: c.sname, tt: "law", tgt: c.tgt, ...keep, srcHash, ...(fb ? { fb: true } : {}) });
      return;
    }
    const v = verdicts.get(i);
    if (!v || !v.real) return;
    // 관계유형(rt)은 규칙 분류기로 일원화 — LLM은 참·거짓 게이트만 맡는다. LLM의 rt는 8종 축소
    // 집합이라 일괄 재분류(규칙 9종+rtConf)와 체계가 갈라졌고, 실측(E4B 4회)에서 전 건을 한
    // 값(준용적용)으로 밀어 판별력이 없었다. 문서 참조는 대상 절을 찾아, 조문 참조는 인용 맥락으로.
    const cls = c.type === "외부규정"
      ? classifyRelTypeForTarget(arts[c.sci]?.fullText || c.snip, c.tdoc || c.tgt)
      : classifyRelType(c.snip);
    if (c.type === "외부규정") {
      const prev = prevOf((e) => e.kind === "ref" && e.tt === "doc" && String(e.tdoc) === c.tdoc);
      edgeDocs.push({ kind: "ref", sdoc: title, sci: c.sci, sname: c.sname, rt: cls.rt, rtConf: cls.conf, tt: "doc", tdoc: c.tdoc, reason: String(prev?.reason || ""), srcHash, ...(fb ? { fb: true } : {}) });
    } else {
      const prev = prevOf((e) => e.kind === "ref" && e.tt === "chunk" && String(e.tname) === c.tname);
      edgeDocs.push({ kind: "ref", sdoc: title, sci: c.sci, sname: c.sname, rt: cls.rt, rtConf: cls.conf, tt: "chunk", tdoc: title, tci: c.tci, tname: c.tname, reason: String(prev?.reason || ""), srcHash, ...(fb ? { fb: true } : {}) });
    }
  });
  const refEdges = edgeDocs.filter((e) => e.kind === "ref").length;
  const lawEdges = edgeDocs.filter((e) => e.kind === "law").length;
  if (edgeDocs.length) await ecol.insertMany(edgeDocs);

  // 이번 적재에서 '엣지 0개'로 끝난 조문 해시를 박제 → 다음 재적재 때 무변경이면 재도출 skip.
  // 폴백이 스친 조문은 "엣지 0개가 확정"이 아니라 "판정 불능"이므로 박제하지 않는다.
  const withEdge = new Set(edgeDocs.map((e) => Number(e.sci)));
  const noEdgeHashes = arts.map((_, i) => i).filter((i) => !withEdge.has(i) && !fbSci.has(i)).map((i) => artHash[i]);
  await ecol.replaceOne({ kind: "arthash", sdoc: title }, { kind: "arthash", sdoc: title, hashes: noEdgeHashes }, { upsert: true });

  // 3) 위계 엣지 upsert
  if (directParent && directParent.trim()) {
    await ecol.deleteMany({ kind: "hier", sdoc: title });
    await ecol.insertOne({ kind: "hier", sdoc: title, tdoc: directParent.trim() });
  }

  return { vectors: vrows.length, refEdges, lawEdges, reused, edgeReused, llmFallback, embedFailed, embedTruncated };
}
