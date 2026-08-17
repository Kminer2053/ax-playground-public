/**
 * 규정 개정 → 업무 근거 영향 분석.
 *
 * 적재로 조문이 바뀌면, 그 조문을 근거로 삼던 업무 엣지는 더 이상 원문과 맞지 않는다.
 * 이 모듈은 그것을 **감지해 격리(stale)** 한다. 격리되는 순간 런타임 필터가 걸러내므로
 * 잘못된 근거가 사용자에게 노출되는 일이 즉시 멈춘다 — 이것이 이 설계의 핵심 이득이다.
 *
 * **자동으로 고치지는 않는다.** 근거를 새 조문으로 갈아끼우는 것은 사람의 판단이다
 * (ONTOLOGY.md: "AI는 초안, 확정은 원문·사람"). 여기서 하는 일은 감지·격리·기록까지다.
 *
 * 다만 **복구는 자동이다**: 재적재로 조문이 원래대로 돌아오면 격리를 푼다. 근거 내용을
 * 바꾸는 게 아니라 일치를 재확인하는 것이라 안전하고, 이게 없으면 한 번 어긋난 엣지가
 * 영원히 격리된 채 남는다.
 */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { collectionName } from "@/lib/collections";
import { articleHash, verifyArticleHash } from "@/lib/article-hash";

/** 격리 사유 — 사람이 조치할 때 판단이 달라지는 단위로 나눈다. */
export type StaleReason = "text-changed" | "row-changed" | "article-removed" | "doc-removed";

/**
 * 행 해시 — 대형 별표의 완충 장치(ONTOLOGY.md §3 "대형 별표 완충").
 *
 * 「별표 제1호 (전결사항)」는 12,934자 단일 조문이라 한 행만 개정돼도 조문 해시가 통째로 바뀐다.
 * 조문 해시만 보면 그 별표에 걸린 근거 605건(전체 조문근거의 66%)이 한꺼번에 격리돼 쓸 수 없다.
 * 그래서 rowHash를 가진 엣지는 **그 행이 지금도 본문에 있는지**로 판정한다.
 *
 * 판정 앵커는 `evidence.rowText`(정렬된 원문 행), 없으면 `quote`다 — 생성 당시엔 quote가 곧 행이었다.
 * 추출 파싱 잡음으로 quote가 원문 행과 어긋난 16건은 `assets:realign`이 rowText를 채워 맞췄다.
 * quote 자체는 사람이 읽는 인용문이라 건드리지 않는다(원문 행은 셀 단위로 잘려 인용에 부적절).
 */
const rowHashOf = (rowText: string) =>
  createHash("sha1").update(String(rowText).replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
/** 항목 앞 번호와 끝 개정 마커를 털어낸 행 본체 — 「1. 정기 감사」·「13. … <개정 2024.4.15.>」 */
const stripLead = (s: string) => norm(s).replace(/^\d+[.)]\s*/, "").replace(/\s*<[^>]*>\s*$/, "").trim();

/**
 * 조문 본문을 행 단위로 쪼갠 집합. 두 가지 원문 구조를 함께 다룬다.
 *  - 표(별표 제1호 전결사항): `| 13. 업무명 | ● |` → 셀 단위
 *  - 목록(별표 제6·7호 분장업무): `1. 정기 감사` → 줄 단위
 * 실측 재현율 — 별표 1호 328/328, 7호 92/92, 6호 136/185(73%).
 */
function rowSetOf(body: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(body ?? "").split("\n")) {
    const line = norm(raw);
    if (!line) continue;
    for (const piece of line.includes("|") ? line.split("|") : [line]) {
      // 별표 6호는 한 셀에 항목이 개행 없이 이어붙는다: 「1. 전사적 비전 수립2. 경영전략 수립…」.
      // 근거는 그 항목 하나를 가리키므로 번호 앞에서 다시 쪼갠다. 과분할은 무해하다 — 이 집합은
      // 포함 여부 판정에만 쓰이므로 후보가 늘 뿐이다.
      for (const item of piece.split(/(?=\d+[.)]\s*\S)/)) {
        const cell = stripLead(item);
        if (cell) out.add(cell);
      }
    }
  }
  return out;
}

export type ImpactResult = {
  doc: string;
  /** 근거가 지금 원문과 맞아 손대지 않은 엣지 */
  intact: number;
  /** 이번에 새로 격리한 엣지 */
  staled: { edgeKey: string; task: string; name: string; reason: StaleReason }[];
  /** 조문이 되돌아와 격리를 푼 엣지 */
  restored: { edgeKey: string; task: string; name: string }[];
  /** 이미 격리돼 있어 그대로 둔 엣지 */
  alreadyStale: number;
  /** 레거시 해시(내용은 동일) — 개정이 아니므로 격리하지 않고 현행 해시로 올려둔다 */
  migrated: number;
  /** 영향받은 업무 id */
  tasks: string[];
};

type EdgeLite = {
  _id: unknown;
  edgeKey?: string;
  from?: string;
  stale?: unknown;
  evidence?: { name?: string; srcHash?: string; rowHash?: string; rowText?: string; quote?: string };
};

const db = () => {
  const d = mongoose.connection.db;
  if (!d) throw new Error("DB 연결이 없습니다 — connectDb() 먼저 호출하세요.");
  return d;
};

/**
 * 문서 하나의 개정이 업무 근거에 미친 영향을 판정하고 반영한다.
 * 적재 커밋이 끝난 뒤(조문이 이미 교체된 상태에서) 호출한다.
 */
export async function analyzeOntologyImpact(title: string): Promise<ImpactResult> {
  const regs = db().collection(collectionName("ragRegulation"));
  const edges = db().collection(collectionName("ontologyEdges"));

  const reg = (await regs.findOne(
    { title },
    { projection: { "articles.name": 1, "articles.fullText": 1 } },
  )) as { articles?: { name: string; fullText?: string }[] } | null;

  // 문서 자체가 사라진 경우와 조문만 사라진 경우는 조치가 다르므로 사유를 구분한다.
  const docRemoved = !reg;
  const bodyOf = new Map((reg?.articles ?? []).map((a) => [a.name, a.fullText ?? ""]));

  const found = (await edges
    .find({ "evidence.doc": title }, { projection: { edgeKey: 1, from: 1, stale: 1, "evidence.name": 1, "evidence.srcHash": 1, "evidence.rowHash": 1, "evidence.rowText": 1, "evidence.quote": 1 } })
    .toArray()) as EdgeLite[];

  const out: ImpactResult = { doc: title, intact: 0, staled: [], restored: [], alreadyStale: 0, migrated: 0, tasks: [] };
  const now = new Date();
  const touched = new Set<string>();
  const rowCache = new Map<string, Set<string>>();
  const rowsFor = (n: string, b: string) => {
    let r = rowCache.get(n);
    if (!r) { r = rowSetOf(b); rowCache.set(n, r); }
    return r;
  };

  for (const e of found) {
    const name = e.evidence?.name;
    // 조문 앵커가 없는 관계(기능분류·선행 등)는 개정과 무관하다.
    if (!name) { out.intact += 1; continue; }

    const body = bodyOf.get(name);
    const hash = e.evidence?.srcHash;
    const rowHash = e.evidence?.rowHash;
    const quote = e.evidence?.quote ?? "";
    // 판정 앵커: 정렬된 원문 행(rowText)이 있으면 그것, 없으면 quote(생성 당시엔 quote가 곧 행이었다).
    const anchor = e.evidence?.rowText || quote;

    let reason: StaleReason | null = null;
    if (docRemoved) reason = "doc-removed";
    else if (body === undefined) reason = "article-removed";
    else if (rowHash) {
      // 행 앵커가 있으면 조문 해시가 아니라 **그 행**을 본다. 별표의 다른 행이 바뀌어도 이 근거는 무관하다.
      // quote가 온전한 행이어야 이 판정이 성립하므로, 그렇지 않으면 조문 해시로 되돌아간다(보수적).
      if (anchor && rowHashOf(anchor) === rowHash) {
        // 행 집합에 **그대로** 있어야 생존으로 본다. 부분 문자열 포함으로 완화하면
        // 행 끝에 덧붙은 개정(「…보고 (개정)」)을 통째로 놓친다 — 실측으로 확인했다.
        // 그래서 놓치기(미탐)보다 과잉 격리를 택한다. 과잉분은 재검토 큐에서 사람이 풀 수 있지만,
        // 놓친 것은 아무도 모른 채 틀린 근거가 계속 노출된다.
        reason = rowsFor(name, body).has(stripLead(anchor)) ? null : "row-changed";
      } else if (hash && verifyArticleHash(name, body, hash) === "changed") reason = "text-changed";
    } else if (hash && verifyArticleHash(name, body, hash) === "changed") reason = "text-changed";
    // 해시가 아예 없으면 판단 불가 — 개정으로 단정하지 않고 조문 쪽 issue로 남긴다.

    if (reason) {
      if (e.stale) { out.alreadyStale += 1; continue; }     // 이미 격리 — 사유를 덮어쓰지 않는다
      await edges.updateOne(
        { _id: e._id as never },
        {
          $set: {
            stale: { reason, since: now },
            // 변경 전 값을 남겨야 관리자가 지금 원문과 비교해 판단할 수 있다.
            staleFrom: { name, srcHash: hash ?? "", rowHash: rowHash ?? "", quote, at: now },
          },
        },
      );
      out.staled.push({ edgeKey: e.edgeKey ?? "", task: e.from ?? "", name, reason });
      if (e.from) touched.add(e.from);
      continue;
    }

    // 일치 — 격리 상태였다면 푼다(조문이 되돌아온 경우).
    if (e.stale) {
      await edges.updateOne({ _id: e._id as never }, { $set: { stale: null }, $unset: { staleFrom: "" } });
      out.restored.push({ edgeKey: e.edgeKey ?? "", task: e.from ?? "", name });
      if (e.from) touched.add(e.from);
      continue;
    }

    // 레거시 해시(앞 200자 규약)는 내용이 같다는 뜻이므로 개정이 아니다. 현행 해시로 올려둔다.
    if (!rowHash && hash && body !== undefined && verifyArticleHash(name, body, hash) === "legacy") {
      await edges.updateOne({ _id: e._id as never }, { $set: { "evidence.srcHash": articleHash(name, body), "evidence.hashRev": 2 } });
      out.migrated += 1;
    }
    out.intact += 1;
  }

  out.tasks = [...touched];
  return out;
}

/** 적재 응답·CLI 로그에 쓸 한 줄 요약. 아무 일도 없었으면 빈 문자열. */
export function summarizeImpact(r: ImpactResult): string {
  const parts: string[] = [];
  if (r.staled.length) {
    const byReason = r.staled.reduce<Record<string, number>>((m, s) => ({ ...m, [s.reason]: (m[s.reason] ?? 0) + 1 }), {});
    const label: Record<string, string> = { "text-changed": "본문 변경", "row-changed": "해당 행 변경", "article-removed": "조문 소실", "doc-removed": "문서 삭제" };
    const detail = Object.entries(byReason).map(([k, n]) => `${label[k] ?? k} ${n}`).join("·");
    parts.push(`업무근거 ${r.staled.length}건 재검토 필요(${detail}) — 업무 ${r.tasks.length}개`);
  }
  if (r.restored.length) parts.push(`격리 해제 ${r.restored.length}건(조문 복귀)`);
  if (r.migrated) parts.push(`해시 규약 갱신 ${r.migrated}건`);
  return parts.join(" · ");
}
