# data/laws — 외부 법령·행정규칙 수집 작업 폴더

`src/scripts/fetch-external-laws.mjs`(**인터넷 되는 개발망 전용**)가 법제처 국가법령정보 DRF API로
법령 원문을 수집할 때 쓰는 폴더입니다. 수집 결과(`raw/`, `md/`)는 기관 데이터라 공개 저장소에
동봉하지 않습니다 — 폐쇄망에는 변환된 `md/*.md`만 반입해 `npm run laws:ingest`로 적재합니다.

| 경로 | 내용 | 출처 |
|---|---|---|
| `aliases.json` | 법령명 보정 맵(입력) — 아래 참조 | 리포 동봉(예시) — 기관에 맞게 수정 |
| `raw/*.json` | 법령 전문(수집 산출물) | `fetch-external-laws.mjs`가 생성 |
| `md/*.md` | 적재용 md 변환본 | `convert-laws-to-md.mjs`가 생성 |
| `collect-report.json` | 수집·해석 결과 대사 | `fetch-external-laws.mjs`가 생성 |

## aliases.json 형식

수집 대상은 DB(`rag_graph_edges`)의 `lawName` 목록에서 자동으로 뽑고, `aliases.json`은 그중
**이름이 그대로는 검색되지 않는 항목만** 보정합니다(없는 이름은 무시되므로 예시를 지워도 됩니다).

```json
{
  "<DB에 기록된 법령명>": {
    "q": "<법제처 검색에 쓸 정식 명칭 (생략 시 원문명 그대로)>",
    "target": "law | admrul | skip  (기본 law — admrul=행정규칙, skip=수집 제외)",
    "note": "<메모 (collect-report에 남음)>"
  }
}
```

빈 객체 `{}` 만 있어도 스크립트는 동작합니다. 사용법은 루트 [README.md](../../README.md)의
"외부 법령·행정규칙 수집" 절을 보세요.
