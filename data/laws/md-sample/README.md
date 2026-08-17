# md-sample — 법령 md 형식 예시

이 폴더의 `법령_*.md`는 **가상의 발췌 샘플**로, 법령 적재 파이프라인의 파일 형식을 보여 주는 용도입니다.
`npm run laws:ingest`는 `data/laws/md/` 폴더를 읽으므로, 형식 확인이나 적재 시연이 필요하면 이 샘플을
`data/laws/md/`로 복사한 뒤 실행하십시오(파일명 접두어 `법령_`/`행정규칙_`이 곧 분류입니다).
실제 운영 데이터는 법제처 수집본(`fetch-external-laws.mjs` → `convert-laws-to-md.mjs`)으로 만들고,
이 샘플은 적재 후 삭제해도 됩니다.
