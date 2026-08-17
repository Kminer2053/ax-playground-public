import { RagRegulationModel } from "@/models/RagRegulation";

/**
 * 인앱 BM25 — 자체호스팅 MongoDB의 $text 한국어 미지원(조사 안 떨어짐, 형태소 없음) 보완.
 * 문서 단위(rag_regulation)로 한국어 char bi-gram 토크나이저 + Okapi BM25. 인메모리(~100문서, 즉시).
 * 효과: TF 포화·문서길이 정규화·IDF로 키워드 레그의 정밀도/순위 향상. 의미검색(bge-m3)과 보완 관계.
 */
type Doc = { title: string; tf: Map<string, number>; len: number };
type Bm25 = { docs: Doc[]; df: Map<string, number>; avgdl: number; N: number };

let CACHE: Bm25 | null = null;
let loading: Promise<Bm25 | null> | null = null;

const K1 = 1.5;
const B = 0.75;

/** 한국어 char bi-gram(+영숫자 원형) 토크나이저 — 조사·어미 변화를 부분문자열로 흡수. */
export function tokenizeKo(text: string): string[] {
  const s = String(text || "").toLowerCase();
  const words = s.replace(/[^0-9a-z가-힣]+/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (/^[0-9a-z]+$/.test(w)) { out.push(w); continue; } // 영숫자(법령명·번호)는 원형 유지
    if (w.length === 1) { out.push(w); continue; }
    for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); // 한글 bigram
  }
  return out;
}

function blobOf(d: { title?: string; content?: string; articles?: { name: string; fullText?: string }[] }): string {
  const arts = (d.articles ?? []).map((a) => `${a.name} ${a.fullText ?? ""}`).join(" ");
  // 제목은 2회 반복으로 가중(제목 매칭이 본문보다 중요)
  return `${d.title ?? ""} ${d.title ?? ""} ${d.content ?? ""} ${arts}`;
}

async function loadBm25(): Promise<Bm25 | null> {
  if (CACHE) return CACHE;
  if (loading) return loading;
  loading = (async () => {
    const rows = (await RagRegulationModel.find({ category: { $nin: ["법령", "행정규칙"] } }) // 외부규범 격리(ONTOLOGY.md §5)
      .select({ title: 1, content: 1, "articles.name": 1, "articles.fullText": 1 })
      .lean()) as { title?: string; content?: string; articles?: { name: string; fullText?: string }[] }[];
    if (!rows.length) return null;
    const docs: Doc[] = [];
    const df = new Map<string, number>();
    let totalLen = 0;
    for (const r of rows) {
      const toks = tokenizeKo(blobOf(r));
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      docs.push({ title: String(r.title ?? ""), tf, len: toks.length });
      totalLen += toks.length;
    }
    CACHE = { docs, df, avgdl: totalLen / docs.length || 1, N: docs.length };
    return CACHE;
  })();
  const r = await loading;
  loading = null;
  return r;
}

export type Bm25Hit = { title: string; score: number };

/** 질의 BM25 점수 상위 문서 제목 반환. */
export async function bm25SearchTitles(query: string, k = 20): Promise<Bm25Hit[]> {
  const idx = await loadBm25();
  if (!idx) return [];
  const qToks = [...new Set(tokenizeKo(query))];
  if (!qToks.length) return [];
  const idf = new Map<string, number>();
  for (const t of qToks) {
    const n = idx.df.get(t) ?? 0;
    idf.set(t, Math.log(1 + (idx.N - n + 0.5) / (n + 0.5))); // 양수 보장 BM25 idf
  }
  const scored = idx.docs
    .map((d) => {
      let s = 0;
      for (const t of qToks) {
        const f = d.tf.get(t);
        if (!f) continue;
        const denom = f + K1 * (1 - B + B * (d.len / idx.avgdl));
        s += (idf.get(t) ?? 0) * ((f * (K1 + 1)) / denom);
      }
      return { title: d.title, score: s };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** (테스트·관리용) 캐시 무효화 */
export function clearBm25Cache() { CACHE = null; }
