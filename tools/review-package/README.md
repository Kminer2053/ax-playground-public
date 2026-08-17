# 부서검토 패키지 빌더

폐쇄망 내부망 PC에서 그대로 열리는 **단일 HTML**(외부 리소스 0) 검토 요청서를 만든다.
데이터·규정 원문·업무흐름도 SVG를 전부 인라인하므로 서버 없이 파일 하나로 배포된다.

## 사용

```bash
mkdir -p /tmp/rv
mongosh --quiet axplayground tools/review-package/extract.js          > /tmp/rv/data.json
mongosh --quiet axplayground tools/review-package/extract-articles.js > /tmp/rv/articles.json
node tools/review-package/build.mjs /tmp/rv/data.json /tmp/rv/articles.json /tmp/rv/index.html
```

배포 골격(`serve-review.mjs`, `시작하기.bat`, `먼저읽기.txt` 등)은 기존 배포 zip에서 가져와
`index.html`만 교체한 뒤 다시 압축한다. **산출물(html·zip)은 리포에 두지 않는다.**

## 구성

| 파일 | 역할 |
|---|---|
| `extract.js` | 온톨로지 Task + 소관·전결·업무근거 + 보드 SVG 추출(mongosh) |
| `extract-articles.js` | 온톨로지가 참조하는 조문 원문 추출 — 패키지 내 원문 대조용 |
| `build.mjs` | 카드 마크업 생성 + 템플릿 결합 → 단일 HTML |
| `template-head.html` | `<head>`(스타일 전체) |
| `template-shell.html` | 헤더·부서 내비(`__NAV__`)·안내문(`__COUNT__`/`__HQ__`/`__FIELD__`/`__DEPTS__`) |
| `template-tail.html` | 보드 라이트박스(`#lb`/`#lbImg`/`#lbClose`) — 섹션 뒤에 위치해야 한다 |
| `template-script.js` | 이벤트 로직. `__DATA__` 자리에 `BOARDS`·`ART` 상수가 주입된다 |

## 마크업 규약(스크립트가 의존하므로 변경 시 함께 고칠 것)

- 부서 구획: `<section class="dept" data-dept="…" [hidden]>` — 첫 부서만 표시, 전환은 `hidden` **속성**
- 보드 버튼: `<button class="board-open" data-task data-label>` → `BOARDS[data-task]`
- 원문 링크: `<span class="artlink" data-art="문서명#조문명" [data-q]>` → `ART[data-art]`
- 검토 입력: `<div class="review" data-task data-dept>` 안에 라디오(`value=ok|fix`)와 `.rnote`

## 배지 규칙

- 상태(`st`): `promoted`=승격 · `validated`=원문확인 · `candidate`=검토요망
- 생성 방법(`mchip`): `rule`·`manual`=확정(규정확정/원문확인) · `llm`=AI추정 — 검토자가 신뢰도를 구분한다


## v4 (2026-08-04) — 단일 HTML + PDF 제출

폐쇄망에 서빙할 장비를 마련하기 어려워 **서버 방식을 걷어냈다.** 이제 `index.html` 한 파일이
전부다. 부서는 파일을 열어 의견을 넣고 **[의견서 PDF로 저장]** 으로 결과물을 만들어 회신한다.

- PDF는 **브라우저 인쇄의 "PDF로 저장"** 을 쓴다. 폐쇄망에서 외부 PDF 라이브러리를 인라인하면
  한글 폰트를 통째로 embed해야 해 파일이 수 MB 더 늘고 글자가 깨질 위험이 있다. 인쇄 경로는
  OS 폰트를 그대로 써서 한글이 안전하고 의존성이 0이다.
- 화면은 탐색용, 인쇄는 제출용으로 갈린다(`@media print` + `#printSheet`). 인쇄 시점에만
  부서·작성자·판정·의견을 표로 조립해 끼우고, 끝나면 화면을 되돌린다.
- 제거: `serve-review.mjs`, `*.bat`, `submissions/`, `/api/submit` 호출.
  남긴 것: "데이터로 내려받기(JSON)" 버튼 — 취합 담당자가 기계적으로 모을 때 쓴다.

문구는 humanizer 스킬로 윤문했다(피동 남용·명사 사슬·조사 번역투 제거).
