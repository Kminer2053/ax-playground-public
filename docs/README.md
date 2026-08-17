# 문서 인덱스

## 도입
- **[ADOPTION_GUIDE.md](ADOPTION_GUIDE.md)** — **타기관 도입 가이드** — 인프라 준비→설치→설정→데이터 적재→브랜딩·건물 커스터마이징 전 과정 ★

## 설치 · 운영
- **[OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)** — 폐쇄망(에어갭) 설치 가이드(Ubuntu/WSL2) ★ **운영 기준**
- [OFFLINE_INSTALL_WINDOWS.md](OFFLINE_INSTALL_WINDOWS.md) — 폐쇄망 설치 — 네이티브 Windows(WSL 없이)
- **[CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md](CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md)** — GitHub→업무용 PC→Gitea **커밋 해시 동기화** (시스템 담당자용) ★
- [CLOSED_NETWORK_GIT_BUNDLE_SYNC.md](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) — git bundle 실무 절차(전체·증분·스크립트)
- **[CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md](CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md)** — 내부망 `4f2d67d`→최신 main · Linux 실운영 · DB 증분·유실 금지 (담당자용) ★
- [CLOSED_NETWORK_LINUX_UPDATE.md](CLOSED_NETWORK_LINUX_UPDATE.md) — 폐쇄망 Linux 서버 소스·RAG 업데이트
- [CLOSED_NETWORK_WINDOWS_UPDATE.md](CLOSED_NETWORK_WINDOWS_UPDATE.md) — 폐쇄망 Windows 소스·의존성 업데이트
- [../infra/README.md](../infra/README.md) — 인프라 가드레일(Ollama Modelfile·nginx·감사로그·cron)
- [../infra/offline/README.md](../infra/offline/README.md) — 오프라인 번들 조립킷(연결된 머신 → 폐쇄망)
- [../data/mongo-snapshot/README.md](../data/mongo-snapshot/README.md) — Mongo 시드 덤프·복원
- [MongoDB_연결_및_스키마_현황.md](MongoDB_연결_및_스키마_현황.md) — Mongo 연결·스키마 현황
- [../tools/ocr/README.md](../tools/ocr/README.md) — OCR(RapidOCR) 폐쇄망 배포

## 설계 · 구조
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — 패널별 동작구조 도식(Mermaid) ★
- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) — 프로젝트 개요·명세(상세)
- [guardrail-mapping.md](guardrail-mapping.md) — 가드레일 보안 매핑(공공 AI보안 가이드 대응)
- [AX_Portal_통합_시스템_가드레일_구조도.html](AX_Portal_통합_시스템_가드레일_구조도.html) — 가드레일 구조도(다이어그램)
- **[SCALE_HARDENING.md](SCALE_HARDENING.md)** — 다중 사용자 동시성 하드닝 **구현·운영 기록**(노브·수용능력·배포 요건) ★
- [CONCURRENCY_REVIEW.md](CONCURRENCY_REVIEW.md) — 운영 전환 다수사용자 동시성·확장성 점검 및 하드닝 계획(근거·의사결정)

## 데이터 · RAG
- **[RAG_GRAPHRAG.md](RAG_GRAPHRAG.md)** — 사규 하이브리드 RAG(키워드·의미·그래프) 구조·처리방식·증분 적재 ★
- [사규_시드_실행_가이드.md](사규_시드_실행_가이드.md) — 사규 시드 실행 가이드

