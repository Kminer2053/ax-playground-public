# public/fonts — 동봉 폰트와 라이선스

폐쇄망(오프라인)에서도 웹폰트를 받을 수 없으므로 이 디렉터리에 폰트를 직접 동봉한다.
`src/app/globals.css` 의 `@font-face` 가 여기 파일을 `/fonts/...` 경로로 참조한다.

| 파일 | 폰트 | 라이선스 | 전문 |
|------|------|----------|------|
| `NotoSansKR-400/500/600/700/800/900.woff2` | Noto Sans KR (Google / Noto Project) | SIL Open Font License 1.1 | [`OFL.txt`](OFL.txt) |
| `MaterialSymbolsOutlined.ttf` | Material Symbols Outlined (Google) | Apache License 2.0 | [`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt) |

## 고지 사항

- **Noto Sans KR** — Copyright The Noto Project Authors. OFL 1.1 에 따라 재배포하며,
  이 저작권 고지와 라이선스 전문(`OFL.txt`)을 함께 배포한다. woff2 는 웹 사용을 위한
  포맷 변환본이며 "Noto" 예약 명칭(Reserved Font Name)은 사용하지 않는다.
- **Material Symbols Outlined** — Copyright Google LLC.
  Apache License 2.0 에 따라 재배포하며, 라이선스 전문(`LICENSE-Apache-2.0.txt`)을 함께 배포한다.

두 폰트 모두 이 저장소의 MIT 라이선스(루트 [`LICENSE`](../../LICENSE))가 아닌 각자의
라이선스를 따른다. 폰트를 교체·삭제할 때 이 표와 라이선스 파일도 함께 갱신할 것.
