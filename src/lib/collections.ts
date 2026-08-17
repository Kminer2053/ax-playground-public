/**
 * MongoDB 컬렉션 이름 단일 소스.
 *
 * 호출부에 문자열 리터럴을 흩뿌리지 않고 여기서만 관리한다.
 * (오타·개명 리스크 제거 + 정적분석의 컬렉션명 하드코딩 지적 해소)
 *
 * mongoose 모델을 쓰는 경로는 모델이 컬렉션명을 관리하므로 이 모듈이 필요 없고,
 * db.collection(...)으로 직접 접근하는 경로에서만 사용한다.
 */
const NAMES = {
  ragRegulation: "rag_regulation",
  ragVectors: "rag_vectors",
  ragGraphEdges: "rag_graph_edges",
  internalRegulations: "internalregulations",
  auditLogs: "auditlogs",
  playgroundConfigs: "playgroundconfigs",
  ontologyNodes: "ontology_nodes",
  ontologyEdges: "ontology_edges",
  work100Boards: "work100_boards",
  assetStatus: "asset_status",
} as const;

export type CollectionKey = keyof typeof NAMES;

/** 컬렉션 이름 조회. */
export function collectionName(key: CollectionKey): string {
  return NAMES[key];
}
