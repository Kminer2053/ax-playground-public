import mongoose from "mongoose";
import { RagRegulationModel } from "@/models/RagRegulation";
import { collectionName } from "@/lib/collections";

/**
 * GraphRAG 확장 — 시드 문서에서 "질의에 관련된 청크"만 골라, 그 청크의 참조(chunk→doc)를 따라
 * 키워드로는 안 잡힌 관련 규정을 회수. 그래프는 `rag_graph_edges`(LLM 검증된 참조). 빌드: data/graph/.
 */
export type RegLean = {
  _id?: unknown;
  title?: string;
  content?: string;
  year?: string;
  category?: string;
  docNumber?: string;
  articles?: { name?: string; fullText?: string; order?: number }[];
};

export type GraphExpansion = {
  title: string;
  doc: RegLean;
  from: string; // 어느 시드 문서에서
  fromChunk: string; // 어느 조문/별표에서
  rel: string; // 관계유형(근거·준용적용·서식첨부 등)
  reason?: string; // 관계 근거문장(Opus 재타이핑, 있으면 표출)
  weight: number; // 적합도 가중 합
};

type SeedHit = { title?: string; articles?: { name?: string; fullText?: string }[] };

/** 한 문서에서 질의어가 등장하는 청크의 (배열 인덱스=그래프 sci, 적합도 점수) 상위 K개. */
function relevantChunks(articles: SeedHit["articles"], terms: string[], k: number): { i: number; s: number }[] {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length || !terms.length) return [];
  const ts = terms.filter((t) => t && t.length >= 2).map((t) => t.toLowerCase());
  const scored: { i: number; s: number }[] = [];
  list.forEach((a, i) => {
    const name = (a.name ?? "").toLowerCase();
    const body = (a.fullText ?? "").toLowerCase();
    let s = 0;
    for (const t of ts) {
      if (name.includes(t)) s += 3;
      if (body.includes(t)) s += 1;
    }
    if (s > 0) scored.push({ i, s });
  });
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, k);
}

/**
 * 시드 문서들의 '질의 관련 청크'에서 출발하는 chunk→doc 참조를 회수해 상위 limit개 관련 규정 반환.
 * 확장 순위는 참조한 청크의 질의 적합도로 가중(강하게 매칭된 청크의 참조를 우선).
 * @param hits 키워드로 회수된 시드 문서(제목+articles 필요)
 * @param terms 질의 확장 토큰(관련 청크 선별용)
 */
export async function expandViaGraph(hits: SeedHit[], terms: string[], limit = 2, perDocChunks = 4): Promise<GraphExpansion[]> {
  const seedTitles = hits.map((h) => h.title).filter((t): t is string => !!t);
  if (!seedTitles.length) return [];
  const db = mongoose.connection?.db;
  if (!db) return [];

  // hits는 질의 관계순(rerank 순)으로 전달받음 — 상위 시드일수록 가중↑.
  const or: { sdoc: string; sci: { $in: number[] } }[] = [];
  const chunkScore = new Map<string, number>(); // `${title}#${sci}` → 적합도 × 시드순위가중
  hits.forEach((h, rank) => {
    if (!h.title) return;
    const rc = relevantChunks(h.articles, terms, perDocChunks);
    if (!rc.length) return;
    const rankW = 1 / (1 + rank * 0.4);
    or.push({ sdoc: h.title, sci: { $in: rc.map((c) => c.i) } });
    for (const c of rc) chunkScore.set(`${h.title}#${c.i}`, c.s * rankW);
  });
  // 시드 청크가 질의어와 안 맞아도(or 비어도) 역방향·위계 확장은 시도한다 — 정방향만 생략.
  let rows: { sdoc?: string; sci?: number; sname?: string; rt?: string; tdoc?: string; reason?: string }[] = [];
  if (or.length) {
    try {
      rows = await db
        .collection(collectionName("ragGraphEdges"))
        .find({ kind: "ref", tt: "doc", $or: or })
        .project({ sdoc: 1, sci: 1, sname: 1, rt: 1, tdoc: 1, reason: 1, _id: 0 })
        .limit(2000)
        .toArray();
    } catch {
      rows = []; // 그래프 미적재 등 → 정방향 없이 진행
    }
  }

  const seedSet = new Set(seedTitles);
  const agg = new Map<string, GraphExpansion & { best: number }>();
  for (const r of rows) {
    const t = r.tdoc;
    if (!t || seedSet.has(t)) continue; // 이미 시드면 제외
    const w = chunkScore.get(`${r.sdoc}#${r.sci}`) ?? 1; // 참조한 청크의 적합도 가중
    const cur = agg.get(t);
    if (cur) {
      cur.weight += w;
      if (w > cur.best) { cur.best = w; cur.from = r.sdoc ?? cur.from; cur.fromChunk = r.sname ?? cur.fromChunk; cur.rel = r.rt ?? cur.rel; cur.reason = r.reason ?? cur.reason; }
    } else {
      agg.set(t, { title: t, doc: {}, from: r.sdoc ?? "", fromChunk: r.sname ?? "", rel: r.rt ?? "참조", reason: r.reason ?? "", weight: w, best: w });
    }
  }

  // ── 역방향(incoming) 확장 — 엣지는 "인용하는 쪽→인용되는 쪽"이라 상위규정 시드에서 하위 세칙으로
  // 내려가려면 tdoc=시드 조회가 필요(내부 감사 R3: 참조형 벤치 확장 0건의 원인이 단방향 배선).
  // 핵심 3유형(근거·위임·준용적용)만 화이트리스트 — 서식첨부·정의 등 저정보 관계로 인한 노이즈 주입 방지.
  const rankW = new Map<string, number>();
  seedTitles.forEach((t, i) => rankW.set(t, 1 / (1 + i * 0.4)));
  try {
    const revRows = (await db
      .collection(collectionName("ragGraphEdges"))
      .find({ kind: "ref", tt: "doc", tdoc: { $in: seedTitles }, rt: { $in: ["근거", "위임", "준용적용"] } })
      .project({ sdoc: 1, sname: 1, rt: 1, tdoc: 1, reason: 1, _id: 0 })
      .limit(1000)
      .toArray()) as { sdoc?: string; sname?: string; rt?: string; tdoc?: string; reason?: string }[];
    // 역방향도 질의 적합도 게이트 필수 — 없으면 허브 시드(계약업무 처리지침 등)를 인용하는 무관 문서
    // (하자검사 매뉴얼 등)가 질문과 무관하게 유입돼 소형모델 컨텍스트를 오염(A/B 실측: 인사말 붕괴 유발).
    const ts = terms.filter((t) => t && t.length >= 2).map((t) => t.toLowerCase());
    for (const r of revRows) {
      const cand = r.sdoc; // 시드를 인용한 쪽이 확장 후보(예: 시드=인사 규정 → 후보=급여 규정)
      if (!cand || seedSet.has(cand)) continue;
      const relText = `${cand} ${r.sname ?? ""} ${r.reason ?? ""}`.toLowerCase();
      if (ts.length && !ts.some((t) => relText.includes(t))) continue; // 질의어와 무관한 역참조는 제외(정방향과 동일 원칙)
      const w = (rankW.get(r.tdoc ?? "") ?? 0.5) * 1.0; // 청크 적합도가 없으므로 시드 순위 가중만(정방향 우선 유지)
      const reason = r.reason?.trim() || `「${cand}」 ${r.sname ?? ""}이(가) 「${r.tdoc}」을(를) ${r.rt ?? "참조"}로 인용`;
      const cur = agg.get(cand);
      if (cur) {
        cur.weight += w;
        if (w > cur.best) { cur.best = w; cur.from = r.tdoc ?? cur.from; cur.fromChunk = r.sname ?? cur.fromChunk; cur.rel = `${r.rt ?? "참조"}·역참조`; cur.reason = reason; }
      } else {
        agg.set(cand, { title: cand, doc: {}, from: r.tdoc ?? "", fromChunk: r.sname ?? "", rel: `${r.rt ?? "참조"}·역참조`, reason, weight: w, best: w });
      }
    }
  } catch { /* 역방향 실패 → 정방향만으로 진행 */ }

  // ── 위계(hier) 확장 — 문서 상하 관계(102건) 양방향. 가중 낮게(0.8×)로 정방향·역참조에 종속.
  try {
    const hierRows = (await db
      .collection(collectionName("ragGraphEdges"))
      .find({ kind: "hier", $or: [{ sdoc: { $in: seedTitles } }, { tdoc: { $in: seedTitles } }] })
      .project({ sdoc: 1, tdoc: 1, _id: 0 })
      .limit(500)
      .toArray()) as { sdoc?: string; tdoc?: string }[];
    const hts = terms.filter((t) => t && t.length >= 2).map((t) => t.toLowerCase());
    for (const r of hierRows) {
      if (!r.sdoc || !r.tdoc) continue;
      const seedIsParent = seedSet.has(r.tdoc);
      const cand = seedIsParent ? r.sdoc : r.tdoc;
      const seed = seedIsParent ? r.tdoc : r.sdoc;
      if (seedSet.has(cand)) continue;
      // 후보 제목이 질의어와 무관하면 제외(정관 등 범용 상위문서의 무차별 유입 방지) —
      // 모규정 동반(인사규정 시행세칙→인사 규정)은 제목에 질의어가 겹쳐 통과된다.
      if (hts.length && !hts.some((t) => cand.toLowerCase().includes(t))) continue;
      const w = (rankW.get(seed) ?? 0.5) * 0.8;
      const rel = seedIsParent ? "위계(하위)" : "위계(상위)";
      const reason = `문서 위계: 「${r.sdoc}」의 상위 규범이 「${r.tdoc}」`;
      const cur = agg.get(cand);
      if (cur) { cur.weight += w; }
      else agg.set(cand, { title: cand, doc: {}, from: seed, fromChunk: "", rel, reason, weight: w, best: w });
    }
  } catch { /* hier 실패 → 무시 */ }
  const top = [...agg.values()].sort((a, b) => b.weight - a.weight).slice(0, limit);
  if (!top.length) return [];

  const docs = (await RagRegulationModel.find({ title: { $in: top.map((t) => t.title) } })
    .select({ title: 1, content: 1, year: 1, category: 1, docNumber: 1, articles: 1 })
    .lean()) as RegLean[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));
  return top
    .map((t) => ({ title: t.title, doc: byTitle.get(t.title) ?? {}, from: t.from, fromChunk: t.fromChunk, rel: t.rel, reason: t.reason, weight: t.weight }))
    .filter((t) => t.doc.title);
}

/**
 * 후보 문서들 사이의 그래프 연결도(coherence) — 같은 후보군 안에서 doc→doc 참조로 몇 개와 연결됐나(무방향).
 * lexical이 못 보는 '도메인 군집'을 보정하는 재랭킹 신호: 군집에 연결된 문서를 **가산만**(그래프 sparse →
 * 연결 0인 관련문서도 있어 감산은 위험). 같은 도메인끼리 서로 참조하는 구조를 활용해, 어휘만 겹친 타 도메인
 * 오답(예: 광고 계약서)을 상대적으로 밀어낸다. self-loop(자기 별표 첨부 등)는 제외.
 * @returns Map<title, 후보군내 연결 이웃 수>
 */
export async function graphCoherence(titles: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const uniq = [...new Set(titles.filter((t): t is string => !!t))];
  if (uniq.length < 2) return m;
  const db = mongoose.connection?.db;
  if (!db) return m;
  let rows: { sdoc?: string; tdoc?: string }[] = [];
  try {
    rows = await db.collection(collectionName("ragGraphEdges"))
      .find({ kind: "ref", tt: "doc", sdoc: { $in: uniq }, tdoc: { $in: uniq } })
      .project({ sdoc: 1, tdoc: 1, _id: 0 })
      .limit(3000)
      .toArray();
  } catch {
    return m;
  }
  const set = new Set(uniq);
  const nb = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.sdoc || !r.tdoc || r.sdoc === r.tdoc) continue; // self-loop 제외
    if (!set.has(r.sdoc) || !set.has(r.tdoc)) continue;
    if (!nb.has(r.sdoc)) nb.set(r.sdoc, new Set());
    if (!nb.has(r.tdoc)) nb.set(r.tdoc, new Set());
    nb.get(r.sdoc)!.add(r.tdoc);
    nb.get(r.tdoc)!.add(r.sdoc); // 무방향
  }
  for (const [t, s] of nb) m.set(t, s.size);
  return m;
}

/**
 * 시드 문서의 '질의 관련 청크'에서 출발하는 **문서내 조문간(tt:chunk)·외부법령(law)** 관계를 문장으로 반환.
 * 새 문서를 끌어오지 않고 관계 진술만 더해 심층 답변의 관계 설명을 보강(【규정 간 관계】에 합류).
 */
export async function seedRelations(hits: SeedHit[], terms: string[], limit = 8): Promise<string[]> {
  const db = mongoose.connection?.db;
  if (!db) return [];
  const or: { sdoc: string; sci: { $in: number[] } }[] = [];
  const chunkScore = new Map<string, number>();
  hits.forEach((h, rank) => {
    if (!h.title) return;
    const rc = relevantChunks(h.articles, terms, 4);
    if (!rc.length) return;
    const rankW = 1 / (1 + rank * 0.4);
    or.push({ sdoc: h.title, sci: { $in: rc.map((c) => c.i) } });
    for (const c of rc) chunkScore.set(`${h.title}#${c.i}`, c.s * rankW);
  });
  if (!or.length) return [];

  let rows: { sdoc?: string; sci?: number; sname?: string; rt?: string; tt?: string; tname?: string; tgt?: string; lawName?: string; reason?: string; kind?: string }[] = [];
  try {
    rows = await db.collection(collectionName("ragGraphEdges"))
      .find({ $and: [{ $or: or }, { $or: [{ kind: "ref", tt: "chunk" }, { kind: "law" }] }] })
      .project({ sdoc: 1, sci: 1, sname: 1, rt: 1, tt: 1, tname: 1, tgt: 1, lawName: 1, reason: 1, kind: 1, _id: 0 })
      .limit(500).toArray();
  } catch { return []; }

  const scored = rows
    .map((r) => ({ r, w: chunkScore.get(`${r.sdoc}#${r.sci}`) ?? 0 }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { r } of scored) {
    if (r.rt === "미상" || r.rt === "보류") continue; // 불명확분 제외
    let stmt = "";
    if (r.kind === "law") {
      const law = r.lawName || r.tgt;
      if (!law || law === "외부법령") continue; // 식별 안 된 외부법령 제외
      stmt = r.reason?.trim()
        ? `「${r.sdoc}」 ${r.sname} → 외부법령 「${law}」 (${r.rt || "근거"}): ${r.reason.trim()}`
        : `「${r.sdoc}」 ${r.sname} → 외부법령 「${law}」 (${r.rt || "근거"})`;
    } else {
      if (!r.tname) continue;
      stmt = r.reason?.trim()
        ? `「${r.sdoc}」 ${r.sname} → ${r.tname} (${r.rt || "참조"}): ${r.reason.trim()}`
        : `「${r.sdoc}」 ${r.sname} ─${r.rt || "참조"}→ ${r.tname}`;
    }
    const k = stmt.slice(0, 70);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(stmt);
    if (out.length >= limit) break;
  }
  return out;
}
