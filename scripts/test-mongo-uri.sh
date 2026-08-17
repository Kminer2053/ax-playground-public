#!/usr/bin/env bash
set -euo pipefail
# Atlas / 로컬 공통 — 인증·네트워크만 확인 (ping)
# 사용:
#   ./scripts/test-mongo-uri.sh 'mongodb+srv://user:pass@host/...'
#   MONGODB_URI='...' ./scripts/test-mongo-uri.sh

URI="${1:-${MONGODB_URI:-}}"
if [[ -z "$URI" ]]; then
  echo "사용법: ./scripts/test-mongo-uri.sh 'mongodb+srv://...'"
  echo "   또는: MONGODB_URI='...' ./scripts/test-mongo-uri.sh"
  exit 1
fi

SAFE=$(printf '%s' "$URI" | sed -E 's#(//[^:]+:)[^@]+#\1****#')
echo "연결 시도: $SAFE"

if ! command -v mongosh >/dev/null 2>&1; then
  echo "mongosh 가 없습니다. brew install mongosh"
  exit 1
fi

mongosh "$URI" --quiet --eval 'db.runCommand({ ping: 1 })'
echo "OK — ping 성공 (인증·네트워크 정상)"
