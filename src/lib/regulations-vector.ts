import mongoose from "mongoose";
import { getEmbedding } from "./embedding";
import { RagRegulationModel } from "@/models/RagRegulation";
import type { RegLean } from "./regulations-graph";
import { collectionName } from "@/lib/collections";

/**
 * 의미기반 시드 — 사규 청크 임베딩(`rag_vectors`, bge-m3)에 대한 인메모리 코사인 검색.
 * 자체호스팅 MongoDB라 벡터 인덱스가 없어 앱에서 코사인(4천여개라 < 10ms). 빌드: src/scripts/build-embeddings.ts.
 */
type VecCache = { meta: { doc: string; ci: number; name: string }[]; mat: Float32Array; n: number; dim: number };
let CACHE: VecCache | null = null;
let loading: Promise<VecCache | null> | null = null;

async function loadVectors(): Promise<VecCache | null> {
  if (CACHE) return CACHE;
  if (loading) return loading;
  loading = (async () => {
    const db = mongoose.connection?.db;
    if (!db) return null;
    const rows = (await db
      .collection(collectionName("ragVectors"))
      .find({}, { projection: { doc: 1, ci: 1, name: 1, vec: 1, _id: 0 } })
      .toArray()) as unknown as { doc: string; ci: number; name: string; vec: number[] }[];
    if (!rows.length) return null;
    const dim = rows[0].vec.length;
    const n = rows.length;
    const mat = new Float32Array(n * dim);
    const meta: VecCache["meta"] = [];
    for (let i = 0; i < n; i++) {
      const v = rows[i].vec;
      let norm = 0;
      for (let j = 0; j < dim; j++) norm += v[j] * v[j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dim; j++) mat[i * dim + j] = v[j] / norm; // 정규화 저장 → 코사인=내적
      meta.push({ doc: rows[i].doc, ci: rows[i].ci, name: rows[i].name });
    }
    CACHE = { meta, mat, n, dim };
    return CACHE;
  })();
  const r = await loading;
  loading = null;
  return r;
}

export type VecArticleHint = { name: string; ci: number; score: number };
export type VecSeed = { title: string; doc: RegLean; bestChunk: string; score: number; topArticles: VecArticleHint[] };

/** 질의 임베딩 → 코사인 top 청크 → 문서별 최고점으로 묶어 상위 kDocs개 문서 반환(lean).
 *  topArticles: 문서별 상위 조문(코사인순, ≤3) — 컨텍스트 조문 선택에 의미신호로 쓰인다(버리지 않고 배선). */
export async function vectorSearchSeeds(query: string, kDocs = 3, opts?: { model?: string; dims?: number; baseUrl?: string }, topChunks = 72): Promise<VecSeed[]> {
  const c = await loadVectors();
  if (!c) return [];
  const qvRaw = await getEmbedding(query, { model: opts?.model, dims: opts?.dims || c.dim, baseUrl: opts?.baseUrl });
  if (!qvRaw || qvRaw.length !== c.dim) return [];
  let qn = 0;
  for (let j = 0; j < c.dim; j++) qn += qvRaw[j] * qvRaw[j];
  qn = Math.sqrt(qn) || 1;
  const qv = new Float32Array(c.dim);
  for (let j = 0; j < c.dim; j++) qv[j] = qvRaw[j] / qn;

  // 전 청크 코사인
  const scores = new Float32Array(c.n);
  for (let i = 0; i < c.n; i++) {
    let s = 0;
    const off = i * c.dim;
    for (let j = 0; j < c.dim; j++) s += qv[j] * c.mat[off + j];
    scores[i] = s;
  }
  // top 청크 인덱스
  const idx = Array.from({ length: c.n }, (_, i) => i)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, topChunks);
  // 문서별 상위 조문 목록(idx가 전역 내림차순이라 각 문서 배열도 내림차순)
  const byDoc = new Map<string, VecArticleHint[]>();
  for (const i of idx) {
    const m = c.meta[i];
    const arr = byDoc.get(m.doc) ?? [];
    arr.push({ ci: m.ci, name: m.name, score: scores[i] });
    byDoc.set(m.doc, arr);
  }
  const topDocs = [...byDoc.entries()].sort((a, b) => b[1][0].score - a[1][0].score).slice(0, kDocs);
  if (!topDocs.length) return [];

  const docs = (await RagRegulationModel.find({ title: { $in: topDocs.map(([t]) => t) } })
    .select({ title: 1, content: 1, year: 1, category: 1, docNumber: 1, articles: 1 })
    .lean()) as RegLean[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));
  return topDocs
    .map(([title, arts]) => ({ title, doc: byTitle.get(title) ?? {}, bestChunk: arts[0].name, score: arts[0].score, topArticles: arts.slice(0, 3) }))
    .filter((s) => s.doc.title);
}

/** (테스트·관리용) 캐시 무효화 */
export function clearVectorCache() { CACHE = null; }
