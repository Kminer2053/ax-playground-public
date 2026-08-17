/**
 * 지식자산 상태 집계 — 규정 하나가 파이프라인 각 단계에서 무엇을 만들어냈는지.
 *
 * **집계가 진실의 원천이다.** 적재 파이프라인이 결과를 기록하는 방식만 쓰면,
 * CLI·백필·정규화 스크립트처럼 라우트를 거치지 않는 경로로 DB가 바뀔 때 조용히 어긋난다
 * (이 리포는 실제로 그런 스크립트가 많다). 그래서 상태는 언제나 현재 DB에서 다시 셀 수 있고,
 * `asset_status` 컬렉션은 그 결과의 **캐시**일 뿐이다 — 어긋나면 재계산으로 복구된다.
 *
 * 외부 규범(법령·행정규칙)은 검색 격리 대상이라 임베딩·그래프·표태깅을 하지 않는다.
 * 따라서 "임베딩 0"이 정상이며, health 판정에서 결함으로 보지 않는다.
 */
import mongoose from "mongoose";
import { collectionName } from "@/lib/collections";
import { articleHash, verifyArticleHash } from "@/lib/article-hash";

/** 검색 격리 대상 — 임베딩·그래프·표태깅을 하지 않는 것이 정상이다. */
export const EXTERNAL_CATEGORIES = ["법령", "행정규칙"] as const;

export type AssetHealth = "ok" | "attention";

export type AssetStatus = {
  title: string;
  category: string;
  year: string;
  external: boolean;
  articles: { count: number; hashed: number; legacyHash: number; chars: number };
  /** total은 **본문이 있는 조문** 수. 장(章) 제목처럼 본문 0자인 항목은 임베딩 대상이 아니다. */
  embedding: { covered: number; total: number; dims: number; stale: number };
  graph: { hierUp: number; hierDown: number; refOut: number; refIn: number; law: number };
  tables: { count: number; byKind: Record<string, number> };
  /**
   * `stale`은 엣지에 **표시된** 값, `mismatch`는 지금 원문과 **실제로** 대조한 결과다.
   * stale을 세우는 것은 P2(영향 분석)의 몫이라 그 전에는 stale=0·mismatch>0일 수 있다.
   * 그 차이 자체가 "감지는 됐지만 아직 격리되지 않은 근거"를 뜻한다.
   */
  ontology: {
    edges: number; stale: number; tasks: number; byStatus: Record<string, number>;
    mismatch: { changed: number; legacy: number; missing: number };
  };
  boards: { affected: number };
  /** 사람이 조치해야 할 것들. 비어 있으면 health = ok */
  issues: string[];
  health: AssetHealth;
  computedAt: Date;
};

type ArticleLite = { name: string; fullText?: string; srcHash?: string; tableKind?: string };
type RegLite = { title: string; category?: string; year?: string; articles?: ArticleLite[] };

const db = () => {
  const d = mongoose.connection.db;
  if (!d) throw new Error("DB 연결이 없습니다 — connectDb() 먼저 호출하세요.");
  return d;
};

/** 문서 하나의 상태를 현재 DB에서 집계한다. */
export async function computeAssetStatus(title: string): Promise<AssetStatus | null> {
  const reg = (await db()
    .collection(collectionName("ragRegulation"))
    .findOne({ title }, { projection: { title: 1, category: 1, year: 1, "articles.name": 1, "articles.fullText": 1, "articles.srcHash": 1, "articles.tableKind": 1 } })) as RegLite | null;
  if (!reg) return null;

  const arts = reg.articles ?? [];
  const category = reg.category ?? "";
  const external = (EXTERNAL_CATEGORIES as readonly string[]).includes(category);

  // ── 조문: 해시 부여 상태(레거시 200자 해시는 개정 감지 사각지대라 따로 센다) ──
  let hashed = 0, legacyHash = 0, chars = 0, embeddable = 0;
  const byKind: Record<string, number> = {};
  for (const a of arts) {
    const body = a.fullText ?? "";
    chars += body.length;
    // 임베딩 루프(regulations-graph-build.ts)와 같은 기준 — 공백만 남는 조문은 건너뛴다.
    if (body.replace(/\s+/g, " ").trim()) embeddable += 1;
    if (a.srcHash) {
      hashed += 1;
      if (verifyArticleHash(a.name, body, a.srcHash) === "legacy") legacyHash += 1;
    }
    if (a.tableKind) byKind[a.tableKind] = (byKind[a.tableKind] ?? 0) + 1;
  }
  const tableCount = Object.values(byKind).reduce((s, n) => s + n, 0);

  // ── 임베딩: 조문 단위 커버리지 + 스테일 감지 ──
  // "있다"만 세면 임베딩 실패로 옛 벡터가 보존된 상태(새 본문·옛 벡터)를 '전량 커버'로 오판한다.
  // 벡터의 h(생성 당시 본문 해시)를 지금 조문 해시와 대조해 스테일을 따로 센다.
  const vecs = collectionName("ragVectors");
  const [vecRows, dimsDoc] = await Promise.all([
    db().collection(vecs).find({ doc: title }, { projection: { name: 1, h: 1 } }).toArray() as Promise<{ name?: string; h?: string }[]>,
    db().collection(vecs).findOne({ doc: title }, { projection: { vec: 1 } }) as Promise<{ vec?: number[] } | null>,
  ]);
  const covered = [...new Set(vecRows.map((v) => String(v.name ?? "")))];
  const curHash = new Map(arts.map((a) => [a.name, articleHash(a.name, (a.fullText ?? "").replace(/\s+/g, " ").trim())]));
  const staleVec = vecRows.filter((v) => v.h && curHash.has(String(v.name)) && curHash.get(String(v.name)) !== v.h).length;

  // ── 지식그래프 ──
  const edges = collectionName("ragGraphEdges");
  const [hierUp, hierDown, refOut, refIn, law] = await Promise.all([
    db().collection(edges).countDocuments({ kind: "hier", sdoc: title }),
    db().collection(edges).countDocuments({ kind: "hier", tdoc: title }),
    db().collection(edges).countDocuments({ kind: "ref", sdoc: title }),
    db().collection(edges).countDocuments({ kind: "ref", tdoc: title }),
    db().collection(edges).countDocuments({ kind: "law", sdoc: title }),
  ]);

  // ── 업무 온톨로지: 이 규정을 근거로 삼는 엣지 ──
  const onto = await db()
    .collection(collectionName("ontologyEdges"))
    .find({ "evidence.doc": title }, { projection: { from: 1, stale: 1, status: 1, "evidence.name": 1, "evidence.srcHash": 1 } })
    .toArray() as { from?: string; stale?: unknown; status?: string; evidence?: { name?: string; srcHash?: string } }[];

  const bodyOf = new Map(arts.map((a) => [a.name, a.fullText ?? ""]));
  const byStatus: Record<string, number> = {};
  const mismatch = { changed: 0, legacy: 0, missing: 0 };
  let stale = 0;
  const taskSet = new Set<string>();
  for (const e of onto) {
    byStatus[e.status ?? "unknown"] = (byStatus[e.status ?? "unknown"] ?? 0) + 1;
    if (e.stale) stale += 1;
    if (e.from) taskSet.add(e.from);

    // 근거 조문이 지금 원문과 맞는지 실제로 대조한다(엣지의 stale 표시와 별개).
    const name = e.evidence?.name;
    if (!name) continue;                                  // 기능분류·선행 등 조문 근거가 아닌 관계
    const body = bodyOf.get(name);
    if (body === undefined) { mismatch.missing += 1; continue; }
    if (!e.evidence?.srcHash) continue;                   // 해시 미부여는 조문 쪽 issue로 이미 잡힌다
    const verdict = verifyArticleHash(name, body, e.evidence.srcHash);
    if (verdict === "changed") mismatch.changed += 1;
    else if (verdict === "legacy") mismatch.legacy += 1;
  }

  // ── 업무흐름도: 영향받는 보드 ──
  const boards = taskSet.size
    ? await db().collection(collectionName("work100Boards")).countDocuments({ taskId: { $in: [...taskSet] } })
    : 0;

  // ── 조치가 필요한 것만 issues로 ──
  const issues: string[] = [];
  if (arts.length === 0) issues.push("조문이 없습니다");
  if (hashed < arts.length) issues.push(`조문 해시 미부여 ${arts.length - hashed}건 — 개정 감지 불가`);
  if (legacyHash > 0) issues.push(`레거시 해시 ${legacyHash}건 — 조문 앞 200자만 반영(재백필 필요)`);
  if (!external && covered.length < embeddable) issues.push(`임베딩 미커버 조문 ${embeddable - covered.length}건`);
  if (staleVec > 0) issues.push(`임베딩 스테일 ${staleVec}건 — 본문은 바뀌었는데 벡터가 옛것(임베딩 서버 확인 후 재적재)`);
  if (stale > 0) issues.push(`업무근거 재검토 ${stale}건`);
  if (mismatch.changed > 0) issues.push(`업무근거 ${mismatch.changed}건이 현재 조문과 불일치 — 개정 반영 필요`);
  if (mismatch.missing > 0) issues.push(`업무근거가 가리키는 조문 ${mismatch.missing}건 소실`);
  if (mismatch.legacy > 0) issues.push(`업무근거 해시 ${mismatch.legacy}건이 레거시 규약(내용은 동일, 재백필 대상)`);

  return {
    title, category, year: reg.year ?? "", external,
    articles: { count: arts.length, hashed, legacyHash, chars },
    embedding: { covered: covered.length, total: embeddable, dims: dimsDoc?.vec?.length ?? 0, stale: staleVec },
    graph: { hierUp, hierDown, refOut, refIn, law },
    tables: { count: tableCount, byKind },
    ontology: { edges: onto.length, stale, tasks: taskSet.size, byStatus, mismatch },
    boards: { affected: boards },
    issues,
    health: issues.length ? "attention" : "ok",
    computedAt: new Date(),
  };
}

/** 집계 결과를 캐시에 기록한다(문서당 1건, title이 키). */
export async function saveAssetStatus(s: AssetStatus): Promise<void> {
  await db()
    .collection(collectionName("assetStatus"))
    .updateOne({ title: s.title }, { $set: s }, { upsert: true });
}

/** title 유니크 인덱스 — upsert가 동시에 들어와도 행이 갈라지지 않게 한다. */
export async function ensureAssetStatusIndex(): Promise<void> {
  await db().collection(collectionName("assetStatus")).createIndex({ title: 1 }, { unique: true });
}

/** 집계 + 저장. 적재 파이프라인 끝에서 호출한다. */
export async function refreshAssetStatus(title: string): Promise<AssetStatus | null> {
  const s = await computeAssetStatus(title);
  if (s) await saveAssetStatus(s);
  return s;
}

/** 문서가 사라졌으면 캐시도 지운다(제목 변경·삭제 후 유령 행 방지). */
export async function pruneAssetStatus(): Promise<number> {
  const titles = await db().collection(collectionName("ragRegulation")).distinct("title");
  const r = await db().collection(collectionName("assetStatus")).deleteMany({ title: { $nin: titles } });
  return r.deletedCount ?? 0;
}

/** 조문 해시를 현행 규약으로 채운다(누락·레거시 모두). 반환값은 갱신된 조문 수. */
export async function ensureArticleHashes(title: string): Promise<number> {
  const col = db().collection(collectionName("ragRegulation"));
  const reg = (await col.findOne({ title }, { projection: { articles: 1 } })) as { _id: unknown; articles?: ArticleLite[] } | null;
  if (!reg?.articles?.length) return 0;
  let n = 0;
  const arts = reg.articles.map((a) => {
    const h = articleHash(a.name, a.fullText ?? "");
    if (a.srcHash !== h) { n += 1; return { ...a, srcHash: h }; }
    return a;
  });
  if (n) await col.updateOne({ _id: reg._id as never }, { $set: { articles: arts } });
  return n;
}
