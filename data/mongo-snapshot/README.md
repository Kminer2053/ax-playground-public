# data/mongo-snapshot — MongoDB 덤프 작업 폴더

이 폴더는 `mongodump`/`mongorestore` 기반의 시드·업데이트 덤프를 두는 **작업 폴더**입니다.
**공개 저장소에는 덤프가 동봉되지 않습니다** — 사규 원문 등 기관 내부 데이터가 포함되기 때문입니다.
각 기관은 자체 데이터를 적재한 뒤 이 폴더에 스냅샷을 만들어 폐쇄망 반입·복제에 사용하세요.

## 폴더 규칙

| 이름 패턴 | 의미 |
|---|---|
| `dump-YYYY-MM-DD/` | 전체 시드 덤프(`mongodump` 결과). 설치 스크립트가 `dump-*` 글롭으로 자동 선택하므로 **1개만** 두세요 |
| `rag-update-YYYYMMDD/` | RAG 컬렉션만 내보낸 증분 업데이트(`scripts/export-rag-db.sh` 출력) |
| `rag-backup-*/` | `scripts/update-rag-db.sh`가 교체 전 자동 생성하는 백업 |

## 스냅샷 만들기

빈 DB에서 시작해 초기 데이터를 적재(README의 "초기 데이터 온보딩" 절)한 뒤:

```bash
mongodump --uri="mongodb://127.0.0.1:27017" --db=axplayground --out=data/mongo-snapshot/dump-$(date +%Y-%m-%d)
```

## 복원

```bash
mongorestore --uri="mongodb://127.0.0.1:27017" --drop data/mongo-snapshot/dump-*
```

> **주의**: `--drop` 전체 복원은 관리자 설정(`playgroundconfigs`)·퀴즈·공지까지 덮어씁니다.
> 운영 중인 서버에는 전체 복원 대신 RAG 컬렉션만 교체하는 `scripts/update-rag-db.sh`를 사용하세요.

덤프가 없어도 앱은 빈 DB로 기동됩니다 — 초기 적재 절차는 루트 [README.md](../../README.md)를 따르세요.
