#!/usr/bin/env bash
#
# RAG+업무100 6컬렉션 덤프(내보내기) — 배포서버 '부분 업데이트' 반입용 경량 아티팩트.
#   rag_regulation(사규 본문) · rag_vectors(임베딩) · rag_graph_edges(지식그래프)
#   ontology_nodes·ontology_edges(업무100 온톨로지) · work100_boards(절차 보드+렌더캐시)
#
# 사규 개정을 개발/외부망에서 반영(npm run reg:ingest)한 뒤, 이 스크립트로 만든 폴더를
# 폐쇄망 배포서버에 반입해 scripts/update-rag-db.sh 로 적용한다(운영 설정·누적은 불변).
#
# 사용:
#   MONGODB_URI=mongodb://127.0.0.1:27017 [MONGODB_DB=axplayground] \
#     bash scripts/export-rag-db.sh [출력경로]
#   기본 출력: data/mongo-snapshot/rag-update-YYYYMMDD
#
set -euo pipefail

URI="${MONGODB_URI:-mongodb://127.0.0.1:27017}"
DB="${MONGODB_DB:-axplayground}"
OUT="${1:-data/mongo-snapshot/rag-update-$(date +%Y%m%d)}"
# 폐쇄망: 도구가 PATH에 없으면 MONGO_TOOLS=<Database Tools bin 경로> 지정 가능
if [ -n "${MONGO_TOOLS:-}" ]; then PATH="$MONGO_TOOLS:$PATH"; fi

echo "▶ RAG+업무100 6컬렉션 덤프  (URI=$URI · DB=$DB → $OUT)"
# mongodump는 --collection을 1개만 받으므로 컬렉션별로 호출(같은 --out에 누적)
for C in rag_regulation rag_vectors rag_graph_edges ontology_nodes ontology_edges work100_boards; do
  mongodump --uri="$URI" --db="$DB" --collection="$C" --out="$OUT"
done

echo ""
echo "▶ 산출물"
du -sh "$OUT"
ls -lh "$OUT/$DB/"*.bson | awk '{print "  " $5 "\t" $9}'
echo ""
echo "✓ 완료. 배포서버 반입 후:  bash scripts/update-rag-db.sh $OUT"
