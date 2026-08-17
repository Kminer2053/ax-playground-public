# 업무 무한성 데모 v7 — 참조 구현 (사용자 확정 비주얼·UX)

실서비스(M3) 구현의 **실행 가능한 사양서**. 아티팩트: https://claude.ai/code/artifact/a595e7de-6b45-492e-80c5-8832a75e24fe

- `app.js` — 3D 씬(복셀 무한성·대공동·포켓·직각 통로·90° 스냅 카메라·통로 탐험·솔리드 업무큐브) + 온톨로지 패널/전체화면 보드 모달 로직 전부. 실구현 시 three.js는 npm import로 대체(여기선 window.THREE 전역 전제).
- `template.html` — 화면 마크업·스타일(토글·칩·패널·보드 오버레이·무한성 팔레트).
- `transform.py` — three.module.min.js(+core)를 window.THREE 단일 전역 스크립트로 변환(데모 조립용, 실구현 불필요).
- 조립: template의 `__THREE__`/`__APP__`/`__BOARDSVG__`/`__BOARDMOTION__`/`__PILOT__` 치환.
  보드 SVG는 **동봉 샘플** `../sample/boards/수의계약-체결.svg`(+`-motion.svg`) 사용 — 샘플 데이터(`../sample/work-explore-sample.json`)의 "소액 수의계약 체결" 보드를 벤더 CLI로 렌더한 것:
  ```bash
  node vendor/korea100studio/scripts/board.mjs render <board.json> --out out.svg --profile sample
  node vendor/korea100studio/scripts/board.mjs motion <board.json> --out out-motion.svg --profile sample
  ```
  **모션 SVG는 id에 `_m` 접미 필수**(같은 문서 내 정적 SVG와 filter/marker id 충돌 시 카드 소실, WORK100_DESIGN.md §4-1 — 동봉본은 적용 완료) + 구조색 워밍 매핑(조립 스크립트의 COLORMAP, sample 프로필과 세트).
