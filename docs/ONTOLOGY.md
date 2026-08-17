# 업무100 온톨로지 — 개념·어휘·불변식 (v0)

> **목적**: "업무체계 분류 ↔ 규정 실체 연결" 과정에서 암묵지로 있던 판단(어떤 업무가, 어느 부서 소관이며, 누가 전결하고, 무슨 조문을 근거로 하는가)을 **명시적 어휘와 검증 가능한 규칙**으로 정립한다.
>
> **설계 원칙 한 줄**: *새로 만들지 말고 감싼다.* 실체축(사규 그래프)은 이미 성숙해 있으므로([GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) — ref/law/hier 2,800+엣지·srcHash 증분), 온톨로지는 **개념축(부서→업무)** 과 **교차엣지(업무→조문)** 만 신설하고 기존 자산은 참조로 편입한다.
>
> **상태**: v0 / manifest 0.2.0 (2026-07-21, 적대적 검증 1회 반영 — 실데이터 손변환 검증 포함). 기계가독 단일 기준: [`data/ontology/manifest.v0.json`](../data/ontology/manifest.v0.json) — 이 문서는 그 해설이다. 충돌 시 매니페스트가 우선.

관련: [RAG_GRAPHRAG.md](RAG_GRAPHRAG.md)(런타임 A/B/C) · 시각화: korea100studio board-v1(로직 템플릿)·3D 업무지도 · 평가: `data/benchmark/queries.json`(동봉본은 샘플 사규 기준 더미 — 기관 데이터 적재 후 교체)

---

## 1. 전체 구도 — 2축 + 교차

```
[work: 업무 개념축]     Task(업무) ── 선행 ──▶ Task        Task ── 협업 ── Task
 SKOS식 개념 노드          │ │ │                            (무방향, 사전순 정규화 저장)
 (label/alt만, 논리클래스 아님)
                           │ │ └─ 소관 ──▶ Dept(부서) ── 부서상하 ──▶ 직상위 Dept
                           │ └─── 전결 ──▶ Position(직위: 대표이사~지점장, 닫힌 목록)   [org: 조직축]
                           │
                           └─ 업무근거(basis: 전결|절차|기준|서식) ──▶ RegDoc / Article
                                                                        [corpus: 규정 실체축]
                                                          참조 전용(reference_only — 노드 미생성)
                                                          원장=rag_regulation, 내부 관계=rag_graph_edges 소유
```

- **개념과 실체의 분리**가 핵심이다. 업무는 SKOS식 "개념"(이름·별칭·관계만 갖는 노드), 규정은 "문서 실체"(원장=`rag_regulation`)다. 둘을 잇는 `업무근거` 교차엣지가 지금까지 암묵지였던 부분의 명시화다.
- 데모에서 손으로 했던 것의 대응: 6개 부서 버킷=`Dept`, 30개 업무=`Task`, 업무 카드의 "근거 규정" 칩=`업무근거`, 부서 간 연결선=`협업`/`선행`.
- 업무군(TaskGroup)·상위분류는 시드 소스도 소비처도 없어 **v1 예약**으로 강등했다(유형만 늘리고 안 쓰면 무의미 — GRAPH_SCHEMA 교훈).

## 2. 어휘 요약 (규범은 매니페스트)

| 공간쌍 | 관계 | 방향 | evidence | 1차 시드 소스 |
|---|---|---|---|---|
| org→org | `부서상하` | 하위→직상위(hier와 동일 규약) | 선택 | 직제 규정 제6·7조, 「별표 제1호 (기구표)」 |
| work→work | `선행` | 선행→후행 | 선택 | 보드 저작 |
| work→work | `협업` | 무방향(from.id<to.id 정규화 저장) | 선택 | 보드 저작 |
| work→org | `소관` | 업무→부서(주관 의미 단일) | **필수** | 직제세칙 「별표 제6호 (본사 부서별 분장업무)」·「별표 제7호 (지역본부 부서별 분장업무)」 |
| work→org | `전결` | 업무→직위(limit{min,max,text}·condition·positionRule) | **필수** | 위임전결규정 「별표 제1호 (전결사항)」 |
| work→corpus | `업무근거` | 업무→규정/조문/외부법령(basis) | **필수** | LLM 도출+검증 (Phase 1) |
| corpus→corpus | (기존 ref·hier·law) | GRAPH_SCHEMA 규약 | — | **온톨로지 신규 쓰기 금지** |

공통 필드: `status`(candidate→validated→promoted→rejected), `rtConf`(상/중/하), `evidence{doc,name,srcHash,rowHash,quote,external}`, `stale{since,reason}`, `provenance{method,model,at}`.

**전결 특칙**(실데이터 검증에서 확정):
- 한도는 구조화 `limit:{min,max,text}` — 상한형(max)·구간형(min+max)·하한형(min)을 구분해야 "3천만원 물품구입은 누가 전결?" 같은 경계 질의에 답할 수 있다.
- 복합 전결권자 열("본부장/실장", "단장,처장")은 직위별 엣지로 분할하되 `positionRule`로 택일 의미를 보존한다(분할 쌍=원천 1행).
- 전결 엣지는 전결권자 사실의 **유일 표현**이고, 근거 조문은 항상 `업무근거(basis:전결)`로 쌍 생성한다. 별표와 개별 규정 조항이 상충하면 자동 promoted 금지 → 재검토 큐.

## 3. 식별자·앵커 규약 (인벤토리·실측에서 확정)

- **문서 = `rag_regulation.title` 원문 문자열.** `_id`는 재적재(deleteMany+save)마다 바뀌므로 금지. title 개명 시 `evidence.doc` 일괄 치환을 함께 수행.
- **조문 = (title, `articles[].name` 원문) + `srcHash`**(sha1(name+`\n`+공백정규화 본문) 24hex — `regulations-graph-build.ts` hashOf와 동일). **`ci/sci` 배열 인덱스는 앵커 금지**(재적재마다 전체 재색인).
- **스텁 방지**: 목차행 유래 유령 조문이 실재한다(예: 계약업무 처리지침의 '별지 제29호 서식' 28자 스텁 vs 114자 실체 이중 존재). 게이트는 동일 별지·별표 번호 중복 시 최장 본문 우선, 50자 미만 거부. 근본 수정은 적재 정제(스텁 제거)이며 **온톨로지 시드 이전에 수행**(srcHash 재계산 동반).
- **대형 별표 완충**: 「별표 제1호 (전결사항)」는 12.9k 단일 청크라 한 행 개정에도 srcHash가 통째로 바뀐다 → `evidence.rowHash`(행 텍스트 해시 12hex)로 행 불변이면 자동 재확인, 행 변경만 재검토 큐. 행 단위 1급 앵커(Provision)는 v1.
- **외부법령·행정규칙**: 실질 요건이 코퍼스 밖 외부 규범에 위임된 경우가 실재한다 — 예: 수의계약 사유는 계약업무 처리지침 제42조①이 "계약사무규정 제7조"로 위임하는데, 이는 사내 규정이 아니라 **「기타공공기관 계약사무 운영규정」**(기재부, 지침 제1조가 약칭 정의)이다. 식별된 외부 인용은 `ExtLaw` 앵커(lawName 정규화)로 **promoted 가능**하되 UI·보드에 **"외부법령/행정규칙 — 원문 미수록"** 배지를 동반한다(조문 직행 불가를 정직하게). 명칭 미식별 참조만 `evidence.external:true`(promoted 금지)로 남긴다.
- **stale 처분**(구현: `src/lib/ontology-impact.ts`, 적재 3경로에 연결): srcHash 불일치·문서 삭제·조문명 소실 시 자동 `stale`(status 유지, 런타임 제외). 사유는 `{reason, since}`로 남기고 격리 직전 값은 `staleFrom{name,srcHash,rowHash,quote,at}`에 보존한다 — 재검토 화면이 "변경 전 ↔ 지금 원문"을 나란히 보여주려면 이 스냅샷이 있어야 한다.
  - **행 앵커 우선**: `evidence.rowHash`가 있으면 조문 해시가 아니라 그 행이 지금도 원문에 있는지로 판정한다(사유 `row-changed`). 별표 제1호는 12,934자라 완충이 없으면 한 행 개정에 605건이 한꺼번에 격리된다.
  - **판정은 정확 일치**로 한다. 부분 문자열 포함으로 완화하면 행 끝에 덧붙은 개정(「…보고 (개정)」)을 통째로 놓친다 — 놓친 것은 아무도 모르는 채 노출되지만, 과잉 격리는 재검토 큐에서 사람이 푼다.
  - **복구는 자동**: 재적재로 조문이 되돌아오면 격리를 푼다. 근거를 바꾸는 게 아니라 일치를 재확인하는 것이라 안전하며, 없으면 한 번 어긋난 엣지가 영원히 격리된다.
  - 격리는 자동이되 **근거 교체는 사람이 한다**(§"AI는 초안, 확정은 원문·사람").

## 4. 수명주기와 게이트

```
candidate ──기계 게이트──▶ validated ──관리자 승인──▶ promoted ──(앵커 소멸/개정)──▶ stale 플래그
 (규칙/LLM 도출)   │                        │              └─ 런타임 노출(3D 지도·보드·검색)
                   └─▶ rejected             └─▶ rejected
게이트(validated): ①매니페스트 정합 ②앵커 실존(스텁 방지 포함) ③evidence 충족
  (quote·limit.text의 fullText 원문 실존 — 한글 금액↔숫자 정규화 대조) ④양단 노드 validated 이상
promote: 관리자 승인 + 양단 노드 promoted. 노드 rejected 시 부속 엣지 자동 rejected.
```

- **tableGloss는 후보 생성 전용이다.** 실측에서 gloss가 원문에 없는 금액을 부기한 사례가 확인됐다(전도자금 행: 원문 '오십만원'뿐인데 gloss '(금액: 10만원)'). limit·quote는 반드시 fullText에서 절취·대조한다.
- 자동 도출은 candidate까지만(Viva Topics 폐기 교훈). `provenance` 필수 — gemma 조용한 폴백 사고의 재발 방지.
- 기존 체계와의 대응: GRAPH_SCHEMA §5~6의 "자동 반영"≈promoted, "저신뢰 보류·검토 큐"≈candidate/승인 게이트. 신뢰도 필드는 DB 실측 관례인 `rtConf`를 쓴다(§1 구판 표기 conf는 정정 — 실측 conf 0건·rtConf 2,622건, 증분 빌더는 현재 미기록).

## 5. 기존 시스템과의 경계 (안전 조건)

런타임 5개 소비 쿼리(`expandViaGraph` 정방향·역방향·hier 확장, `graphCoherence`, `seedRelations`)는 전부 `kind` 정확 필터(이 중 3개는 `kind+tt`)다. 따라서:

1. **온톨로지는 신규 컬렉션 `ontology_nodes`/`ontology_edges`에만 저장한다.** `rag_graph_edges`의 kind(ref·hier·law + 보조 메타 arthash)·rt 라벨 재사용·개명은 즉시 검색 회귀를 일으키므로 금지(불변식).
2. 기존 벤치마크(100문항, 참조 12문항 포함)는 **회귀 0**이어야 한다 — 유입 경로가 없으므로 자동 충족되는 것을 확인용으로 잰다.
3. 지식검색이 온톨로지를 *활용*하는 배선은 전체 설계 단계의 별도 결정. v0은 격리가 기본값.

## 6. 소비처 매핑과 경계

- **board-v1(korea100studio)**: 보드 내부 절차(stages·nodes·edges)는 **보드 저작물(`work100_boards`, 예정)이 원장**이다. 온톨로지는 ①lanes 후보(소관 Dept·전결 Position) ②`nodes[].refs`(업무근거 evidence에서 **기계 생성** — 매니페스트 board_mapping.refs_item `{label,doc,name,srcHash}`, 표시 문자열 역파싱 금지) ③Task.boardId 연결만 공급한다. Task 내부 단계(Step)는 온톨로지에 저장하지 않는다(v1 예약). emphasis 매핑: 핵심=key·병목=bottleneck·회귀=loop·주도=lead·기본=normal. work100_boards 스키마와 렌더 게이트(board 스키마+참조무결성+audit+refs 실존 대조)는 시범보드 단계 산출물.
- **3D 업무지도**: langent식 3계층 계약 — `graph`=work·org의 promoted 노드/엣지, `cross_links`=업무근거, `points`(선택)=조문 의미공간. 데모의 부서 포켓=Dept, 노드 큐브=Task, 통로=협업/선행.
- **지식검색 조문 직행**: 업무 카드 "근거 조문 보기"=업무근거 evidence 직행, "지식검색에 질문"=Task label+근거 규정명 프리필.

## 7. 수락 기준 (목적 주도 — 이 온톨로지로 답할 질문)

1. 기존 벤치 100문항 회귀 0 (§5).
2. **업무 관점 3형 질의를 promoted 엣지만으로 답할 수 있다**: "X 업무는 어느 부서 소관인가"(소관) · "X는 누가 전결하는가, 한도는 — 경계 금액 포함"(전결 limit.min/max) · "X의 근거 조문은"(업무근거). 시범보드 단계에서 10문항 내외 골드셋 작성.
3. 시범 보드가 온톨로지 엣지에서 board-v1 refs를 기계 생성해 렌더 게이트를 통과한다.

## 8. 시드 데이터 소스 (실측 확정)

| 대상 | 소스(name 원문) | 상태·주의 |
|---|---|---|
| Dept 트리·deptPath | 직제 규정 제6조(본사)·제7조(현업), 직제세칙 「별표 제1호 (기구표)」 | 적재됨. 본부명은 기구표에서(별표 제6호의 세로쓰기 본부명 신뢰 불가) |
| 부서별 분장업무(소관) | 직제세칙 「별표 제6호 (본사 부서별 분장업무)」 8,170자·「별표 제7호 (지역본부 부서별 분장업무)」 | tableGloss 없음 → **명제화 선행**. 원문 4패턴 처리 필요(무개행 연결·번호점 누락·연속행 병합·페이지 반복 헤더) 후 전수 검수, 또는 kordoc 재추출(manual-reextract-workflow) |
| 업무→전결직위·한도 | 위임전결규정 「별표 제1호 (전결사항)」 fullText 12,934자 (tableGloss 약 285행 실측) | gloss는 후보 생성 전용(오염 실증) — limit·quote는 fullText 대조 |
| 직위 어휘 | 위임전결규정 제3조 + 별표 제1호 전결권자 열 실측 | 닫힌 목록 8종(매니페스트). 파트장 등 재위임 직위 v0 미수용 |
| 수의계약 시범 체인 | 계약업무 처리지침 제42·43조, 별지 제29호(실체본), 위임전결 별표 행 + ExtLaw 「기타공공기관 계약사무 운영규정」 제7조 | 적재 전제조건 없음 — 외부 인용은 원문 미수록 배지로 |

## 9. 미결정 사항 (전체 설계 단계로 이월)

- **승인 UI 위치**: 기존 "관계 검토" 큐(GRAPH_SCHEMA §6)와 통합 vs 별도 `/admin/ontology`. 적재 관리자 UI가 미병합 브랜치(feat/admin-ingest-security)에 있는 의존성 포함.
- **시범 단계 임시 승격 경로**: UI 확정 전에는 CLI(`src/scripts/ontology-promote.ts`, provenance method:human 기록)를 공식 우회로로 사용.
- **지식검색 활용 배선**: 업무 관점 질의를 온톨로지로 라우팅할지, 그 신호를 rerank에 얹을지.
- **적재 정제(스텁 조문 제거)** 시행 시점 — 온톨로지 시드 이전 필수, srcHash 재계산 동반.

## 10. 벤치마킹 결론 반영 (근거 요약)

채택: 공간쌍 화이트리스트 문법·evidence 불변식·승격 수명주기(OpenCrab 패턴) / SKOS 개념·altLabel·직접위계만 저장 / ELI Work·Expression(→RegVersion 예약) / 타입드 엣지 속성+닫힌 소수 어휘(PlantOntology 규율) / PROV 최소(provenance) / 매니페스트+개수 대사·적재 영수증(crab 저작 관행).
배제: OWL·트리플스토어·Neo4j(폐쇄망 MongoDB 유지) / 자동 마이닝 단독(Viva Topics 폐기) / 9-space급 메타온톨로지·법제처 222엔티티급 세분화(과설계) / honor-system 게이트(코드 하드 체크로).

## 변경 이력
- v0 / manifest 0.3.0 (2026-07-21) ExtLaw 앵커 — 식별된 외부법령·행정규칙 인용 promoted 허용('외부법령/행정규칙 — 원문 미수록' 배지 필수), external:true는 명칭 미식별 전용으로 축소. 계약사무규정=「기타공공기관 계약사무 운영규정」(외부) 확인으로 시범보드 적재 전제조건 해제.
- v0 / manifest 0.1.0 (2026-07-21) 초안 — 3공간·7관계, 수명주기·불변식·앵커 규약.
- v0 / manifest 0.2.0 (2026-07-21) 적대적 검증 반영 — 직위 목록 실측 교정(사장→대표이사, 단장 추가)·limit 구조화{min,max,text}·positionRule·gloss 후보 전용 강등·external/rowHash/stale 슬롯·스텁 방지 게이트·노드-엣지 수명주기 결합·협업 정규화·TaskGroup/role:협조/상위분류 v1 강등·corpus reference_only 기계가독화·미결정 사항 §9 신설.
