#!/usr/bin/env bash
#
# 기존 운영 DB에 RAG 3컬렉션만 안전하게 업데이트한다:
#   rag_regulation (재청킹 본문) · rag_vectors (임베딩) · rag_graph_edges (지식그래프)
#
# 이 3개는 청크 인덱스로 서로 묶여 있어 반드시 '함께' 교체해야 정합이 맞는다.
# 관리자 설정(playgroundconfigs)·가드레일·콘텐츠·런타임 누적(감사로그·퀴즈 등)은 건드리지 않는다.
# (최초 설치는 전체 복원: mongorestore --drop <dump> — 이 스크립트는 '기존 서버 갱신' 전용)
#
# 사용:
#   MONGODB_URI=mongodb://127.0.0.1:27017 [MONGODB_DB=axplayground] \
#     bash scripts/update-rag-db.sh [덤프경로]
#
set -euo pipefail

URI="${MONGODB_URI:-mongodb://127.0.0.1:27017}"
DB="${MONGODB_DB:-axplayground}"
# 폐쇄망: 도구가 PATH에 없으면 MONGO_TOOLS=/opt/mongodb-database-tools-.../bin 로 지정 가능
if [ -n "${MONGO_TOOLS:-}" ]; then PATH="$MONGO_TOOLS:$PATH"; fi

# 덤프 경로: 인자 > 최신 rag-update-*(부분 반입) > 최신 dump-*(전체 시드 — 3컬렉션만 골라 복원하므로 안전)
DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP=$(ls -d data/mongo-snapshot/rag-update-* data/mongo-snapshot/dump-* 2>/dev/null | sort | tail -1 || true)
fi
if [ -z "$DUMP" ] || [ ! -d "$DUMP" ]; then
  echo "✗ 덤프를 찾을 수 없습니다. 경로를 지정하세요: bash scripts/update-rag-db.sh <덤프경로>" >&2; exit 1
fi

# 덤프 내부 네임스페이스(원본 DB명) 자동 감지 — 다른 DB명으로 export한 덤프도 동작
SRC_DB=$(basename "$(find "$DUMP" -mindepth 1 -maxdepth 1 -type d | head -1)")
if [ -z "$SRC_DB" ] || [ ! -d "$DUMP/$SRC_DB" ]; then
  echo "✗ 덤프 구조가 올바르지 않습니다(하위 DB 폴더 없음): $DUMP" >&2; exit 1
fi

echo "▶ RAG 3컬렉션 업데이트  (URI=$URI · DB=$DB · 덤프=$DUMP)"
echo "  교체: rag_regulation · rag_vectors · rag_graph_edges"
echo "  보존: playgroundconfigs·guardconfigs·featureusages·ontology_*·콘텐츠·런타임 누적"
echo ""

# (권장) 교체 전 현재 3컬렉션 백업
BK="data/mongo-snapshot/rag-backup-$(date +%Y%m%d-%H%M%S)"
echo "▶ 현재 RAG 컬렉션 백업 → $BK"
# mongodump는 --collection을 1개만 받으므로 컬렉션별 호출
for C in rag_regulation rag_vectors rag_graph_edges; do
  mongodump --uri="$URI" --db="$DB" --collection="$C" --out="$BK" 2>/dev/null \
    || echo "  ($C 백업 생략 — 기존 컬렉션 없음일 수 있음)"
done

echo "▶ 복원(--drop, RAG 3컬렉션만)"
mongorestore --uri="$URI" --drop \
  --nsInclude="$SRC_DB.rag_regulation" \
  --nsInclude="$SRC_DB.rag_vectors" \
  --nsInclude="$SRC_DB.rag_graph_edges" \
  $( [ "$DB" != "$SRC_DB" ] && printf -- "--nsFrom=%s.* --nsTo=%s.*" "$SRC_DB" "$DB" ) \
  "$DUMP"

echo ""
echo "▶ 검증"
# mongosh는 Database Tools에 미포함(별도 배포) — 폐쇄망에 없으면 스킵(복원 성공과 무관)
if command -v mongosh >/dev/null 2>&1; then
  mongosh "$URI/$DB" --quiet --eval '
    print("  rag_regulation: " + db.rag_regulation.countDocuments());
    print("  rag_vectors:    " + db.rag_vectors.countDocuments());
    print("  rag_graph_edges:" + db.rag_graph_edges.countDocuments());
  '
else
  echo "  (mongosh 없음 — 카운트 검증 생략. 위 mongorestore 'restored successfully' 로그로 확인)"
fi
echo ""
echo "✓ 완료. 후속(무중단 반영):"
echo "  ① 좌측 사규 검색 목록 동기화(권장):  MONGODB_URI=\"$URI/$DB\" npm run sagyu:build"
echo "     (코드 배포에 최신 public/sagyu.json이 포함돼 있으면 생략 가능)"
echo "  ② 관리자 → 설정 → [RAG 캐시 새로고침] 클릭 — 앱 재시작 없이 새 DB 반영(벡터·BM25 인메모리 캐시 초기화)."
echo "     (버튼 사용이 어려우면 앱 재시작으로도 동일 효과)"
echo "  ③ 의미검색용 임베딩 서버(Ollama bge-m3) 가동 확인."
echo "  ④ 롤백:  mongorestore --uri=\"$URI\" --drop $BK"
