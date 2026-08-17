/**
 * 문서작성 사이드챗 첨부 인덱싱·발췌 — "첨부 = 잘라 넣는 텍스트"가 아니라 "검색 가능한 지식원".
 *
 * 업로드 1회: 전문 추출 → **가드 전수검사**(인젝션·PII, 지금까지의 앞부분-만-검사보다 커버리지 증가)
 *            → 소형은 전문 보관(계층 A), 대형은 청킹+bge-m3 임베딩(계층 B) → Mongo TTL 캐시(24h).
 * 대화 턴:   계층 라우팅 — A 전문 주입 / B 질의연관 top-k 발췌 / B' 요약형 질문엔 구조 스킴(전체 커버리지).
 * 게이트:    8,000자 길이 게이트는 '타이핑 입력'만 검사(정책 취지) — 첨부는 업로드 시 이미 전수 검사됨.
 * 서버 상태: TTL 캐시일 뿐(만료 자동삭제, 재업로드로 복원) — 무로그인·무상태 설계 보존.
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { getEmbedding } from "./embedding";
import { getPlaygroundConfig } from "./playgroundConfig";
import { checkInjection } from "./guardrails/input/injection";
import { checkInputPii } from "./guardrails/input/pii";

export const ATT_MAX_CHARS = 300_000; // 파일당 인덱싱 상한(≈150p 문서) — 엔지니어링 상한(UI 고지), 초과분은 절사
export const ATT_SMALL_MAX = 6_000;   // 이하 = 계층 A(전문 주입, 임베딩 불필요)
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 80;
const TTL_SEC = 24 * 3600;
const EMBED_CONCURRENCY = 5;

export type AttChunk = { i: number; h: string; t: string; vec?: number[]; flagged?: string };
export type AttDoc = {
  attId: string;
  name: string;
  format: string;
  chars: number;            // 인덱싱된 자수(절사 후)
  srcChars: number;         // 원문 자수
  tier: "full" | "indexed";
  toc: string[];
  text?: string;            // full 계층: 전문
  chunks?: AttChunk[];      // indexed 계층
  embedded: boolean;        // 임베딩 성공 여부(false면 키워드 폴백)
  flaggedCount: number;     // 가드에 걸려 주입 제외된 청크 수
  createdAt: Date;
};
export type AttSummary = Pick<AttDoc, "attId" | "name" | "format" | "chars" | "srcChars" | "tier" | "embedded" | "flaggedCount"> & { chunkCount: number; toc: string[] };

let ensured = false;
async function col() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  const c = db.collection<AttDoc>("chat_attachments");
  if (!ensured) {
    ensured = true;
    await c.createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SEC }).catch(() => { /* 이미 존재 */ });
    await c.createIndex({ attId: 1 }).catch(() => { /* 이미 존재 */ });
  }
  return c;
}

const HEADING_RE = /^(#{1,4}\s+.+|제\s*\d+\s*[장조절][^\n]{0,40}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\s*[.\s][^\n]{0,40}|\d+\.\s+[^\n]{2,40})$/;

/** 헤딩(마크다운·제N장/조·로마자 절) 우선 + 문단 경계 청킹(~800자, 80자 겹침). 청크마다 소속 헤딩 기록. */
export function chunkAttachmentText(text: string): AttChunk[] {
  const lines = text.split("\n");
  const out: AttChunk[] = [];
  let heading = "";
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ i: out.length, h: heading, t });
    buf = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP)); // 겹침 유지
  };
  for (const line of lines) {
    if (HEADING_RE.test(line.trim())) {
      if (buf.trim().length > CHUNK_SIZE * 0.4) flush();
      heading = line.trim().replace(/^#+\s*/, "").slice(0, 60);
    }
    buf += line + "\n";
    if (buf.length >= CHUNK_SIZE) flush();
  }
  if (buf.trim()) { const t = buf.trim(); if (t) out.push({ i: out.length, h: heading, t }); }
  return out;
}

/** 가드 전수검사 — 인젝션·PII를 청크 단위로 검사, 걸린 청크는 주입에서 제외(rule 기록). */
function scanChunks(chunks: AttChunk[]): number {
  let flagged = 0;
  for (const c of chunks) {
    const inj = checkInjection(c.t);
    if (!inj.ok) { c.flagged = inj.block.ruleId; flagged++; continue; }
    const pii = checkInputPii(c.t);
    if (!pii.ok) { c.flagged = pii.block.ruleId; flagged++; }
  }
  return flagged;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** 업로드 1회 인덱싱: 청킹 → 가드 전수검사 → (대형) 임베딩 → TTL 저장. */
export async function indexAttachment(name: string, format: string, plainText: string): Promise<AttSummary> {
  const text = plainText.slice(0, ATT_MAX_CHARS);
  const chunks = chunkAttachmentText(text);
  const flaggedCount = scanChunks(chunks);
  const toc = [...new Set(chunks.map((c) => c.h).filter(Boolean))].slice(0, 30);
  const tier: AttDoc["tier"] = text.length <= ATT_SMALL_MAX ? "full" : "indexed";

  let embedded = false;
  if (tier === "indexed") {
    try {
      const cfg = await getPlaygroundConfig();
      if (cfg.ragVectorEnabled && process.env.VECTOR_SEARCH !== "0") {
        const vecs = await mapConcurrent(chunks, EMBED_CONCURRENCY, (c) =>
          c.flagged ? Promise.resolve(null) : getEmbedding(`${c.h}\n${c.t}`.slice(0, 4000), { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl }));
        let ok = 0;
        vecs.forEach((v, i) => { if (v) { chunks[i].vec = v; ok++; } });
        embedded = ok > 0;
      }
    } catch { embedded = false; /* 임베딩 미가동 → 키워드 폴백 */ }
  }

  const doc: AttDoc = {
    attId: randomUUID(), name, format, chars: text.length, srcChars: plainText.length,
    tier, toc, embedded, flaggedCount, createdAt: new Date(),
    ...(tier === "full" ? { text } : { chunks }),
  };
  await (await col()).insertOne(doc);
  return { attId: doc.attId, name, format, chars: doc.chars, srcChars: doc.srcChars, tier, embedded, flaggedCount, chunkCount: chunks.length, toc: toc.slice(0, 12) };
}

export async function getAttachments(attIds: string[]): Promise<AttDoc[]> {
  if (!attIds.length) return [];
  const rows = (await (await col()).find({ attId: { $in: attIds } }).toArray()) as AttDoc[];
  // 요청 순서 유지
  const by = new Map(rows.map((r) => [r.attId, r]));
  return attIds.map((id) => by.get(id)).filter((x): x is AttDoc => !!x);
}

function cos(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export type Excerpt = { text: string; usedChars: number; segments: number; mode: "full" | "topk" | "skim" | "keyword" | "head" };

/**
 * 계층 발췌: full=전문 / indexed=질의연관 top-k(+이웃) / skim=목차 순 균등(요약형 질문의 전체 커버리지).
 * qvec은 호출측에서 1회 임베딩해 전달(파일마다 재임베딩 방지). 임베딩 없으면 키워드 폴백.
 */
export function excerptAttachment(att: AttDoc, o: { qvec?: number[] | null; terms: string[]; budget: number; skim?: boolean }): Excerpt {
  const budget = Math.max(400, o.budget);
  if (att.tier === "full") {
    const t = (att.text ?? "").slice(0, budget);
    return { text: t, usedChars: t.length, segments: 1, mode: "full" };
  }
  const chunks = (att.chunks ?? []).filter((c) => !c.flagged);
  if (!chunks.length) return { text: "", usedChars: 0, segments: 0, mode: "head" };

  // 포함 판정은 '우선순위(랭크)순', 표시는 '문서 위치순' — 위치순으로 채우면 상위 랭크라도
  // 문서 꼬리 청크가 예산에서 구조적으로 밀리는 버그가 생긴다(개정·신설 내용은 꼬리에 많음).
  const assemble = (prioritized: AttChunk[], mode: Excerpt["mode"], per?: number): Excerpt => {
    const render = (c: AttChunk) => `${c.h ? `〔${c.h}〕 ` : ""}${per ? c.t.slice(0, per) : c.t}`;
    const chosen: AttChunk[] = [];
    const seen = new Set<number>();
    let used = 0;
    for (const c of prioritized) {
      if (seen.has(c.i)) continue;
      const len = render(c).length + 4;
      if (used + len > budget && chosen.length > 0) continue; // 초과 청크는 건너뛰고 더 작은 후보로 잔여 예산 활용
      seen.add(c.i);
      chosen.push(c);
      used += len;
      if (used >= budget) break;
    }
    chosen.sort((a, b) => a.i - b.i);
    const text = chosen.map(render).join("\n…\n");
    return { text, usedChars: text.length, segments: chosen.length, mode };
  };

  if (o.skim) {
    // 구조 스킴: 문서 전체를 목차 순서로 균등 표집(요약·전체검토형 질문 — 특정부 유사도가 아니라 커버리지가 필요)
    const per = 240;
    const capacity = Math.max(4, Math.floor(budget / (per + 30)));
    const step = Math.max(1, Math.floor(chunks.length / capacity));
    const picked = chunks.filter((_, k) => k % step === 0).slice(0, capacity);
    return assemble(picked, "skim", per);
  }

  if (o.qvec && att.embedded) {
    // 하이브리드: 코사인 + 용어 적중 보너스 — 긴 청크에서 희소 정답어(예: 문서에 1회 등장)가
    // 반복 서술에 희석돼 코사인만으론 안 뽑히는 문제 보정(사규 검색의 '벡터+키워드' 원칙과 동일).
    const terms = o.terms.filter((t) => t.length >= 2);
    const termBonus = (c: AttChunk) => {
      if (!terms.length) return 0;
      const low = (c.h + " " + c.t).toLowerCase();
      let hits = 0;
      for (const t of terms) if (low.includes(t.toLowerCase())) hits++;
      return Math.min(hits, 4) * 0.12;
    };
    const scored = chunks.filter((c) => c.vec).map((c) => ({ c, s: cos(o.qvec!, c.vec!) + termBonus(c) })).sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 5).map((x) => x.c);
    // 우선순위: 앵커(랭크순) → 그 이웃(문맥 연결). 이 순서 그대로 예산에 담는다.
    const prioritized: AttChunk[] = [];
    const byI = new Map(chunks.map((c) => [c.i, c]));
    for (const c of top) {
      prioritized.push(c);
      const next = byI.get(c.i + 1); if (next) prioritized.push(next);
      const prev = byI.get(c.i - 1); if (prev) prioritized.push(prev);
    }
    return assemble(prioritized, "topk");
  }

  // 키워드 폴백: 질의 토큰 출현 수로 청크 랭킹
  const terms = o.terms.filter((t) => t.length >= 2);
  if (terms.length) {
    const scoreOf = (c: AttChunk) => {
      const low = (c.h + " " + c.t).toLowerCase();
      let s = 0;
      for (const t of terms) { let i = 0; let hits = 0; const sub = t.toLowerCase(); while ((i = low.indexOf(sub, i)) !== -1 && hits < 6) { s++; hits++; i += sub.length; } }
      return s;
    };
    const ranked = chunks.map((c) => ({ c, s: scoreOf(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (ranked.length) return assemble(ranked.slice(0, 6).map((x) => x.c), "keyword");
  }
  // 최후: 문서 머리
  return assemble(chunks.slice(0, 6), "head");
}
