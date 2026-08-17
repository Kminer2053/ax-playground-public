# data/benchmark — 사규검색 품질 골드셋

이 폴더의 골드셋은 **동봉된 샘플 사규 9건**(`data/regulations-2026/`) 기준으로 만든 **더미 문항**입니다.
샘플 사규를 적재한 상태에서 검색 파이프라인이 동작하는지 검증하는 용도이며, 기관의 실제 사규를
적재한 뒤에는 **자기 사규 기준의 문항으로 교체**해야 의미 있는 품질 측정이 됩니다.

| 파일 | 내용 | 스키마 |
| --- | --- | --- |
| `queries.json` | 검색 20문항(직접 6 · 의미 8 · 참조 4 · 범위밖 2) | `[{id, q, expect: [정확한 문서 제목], cat}]` |
| `table-queries.json` | 표형 8문항(전결 3 · 징계양정 3 · 기준표 2) | `[{q, cat, expectDoc, expectEvidence: [표 행 원문], answer}]` |

- `expect`/`expectDoc`의 제목은 적재 후 문서 제목(프런트매터 `규정명`)과 **글자 단위로 일치**해야 합니다.
- `expectEvidence`는 정답 근거가 되는 별표 행의 원문 문자열입니다(공백은 무시하고 대조).
- `cat` 유형: **직접**(원문 용어 그대로 묻기) · **의미**(동의어·일상어 질의) · **참조**(세칙 질의로
  모규정까지 도달해야 하는 유형) · **범위밖**(사규에 없는 주제 — 정확히 거절해야 정답).

## 실행법

```bash
# 1) 검색 벤치마크(개발 서버 기동 후 — 실제 /api/knowledge/assistant 호출)
npm run dev   # 별도 터미널
npx tsx src/scripts/benchmark.ts --label base [--mode both|fast|deep] [--limit N]

# 2) 약식 A/B 비교(유형별 랜덤 10문항 고정 추출)
npx tsx src/scripts/quick-eval.ts --label A [--resample]

# 3) 표형 골드셋(DB 직접 검색 — 서버 불필요, MONGODB_URI 필요)
npx tsx src/scripts/eval-table-gold.ts [tag]
```

결과는 각각 `data/benchmark/results/`(또는 `/tmp`, `backups/`)에 저장되어 변경 전후(label A/B) 비교에
쓰입니다. 문항을 교체할 때는 위 스키마와 유형 구성을 유지하면 스크립트를 그대로 쓸 수 있습니다.
