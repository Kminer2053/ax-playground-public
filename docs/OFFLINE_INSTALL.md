# 폐쇄망(에어갭) 설치 가이드

운영 환경(2종, 모두 인터넷 차단): **① Ubuntu 24.04 네이티브(amd64)** · **② Windows WSL2(Ubuntu 24.04, amd64)**. 앱·DB·LLM·OCR 모두 **루프백(127.0.0.1)** 에서 동작한다. 외부 API는 사용하지 않는다.

> WSL2 배포판이 Ubuntu 24.04/amd64이므로 **동일한 오프라인 번들·스크립트를 두 대상에 그대로** 쓴다. WSL 특이사항은 §0.1.
>
> **③ WSL 없이 네이티브 Windows**로 구동하려면 번들·스크립트가 달라진다(Windows용 Node·MongoDB·휠 + PowerShell). 별도 가이드: [`OFFLINE_INSTALL_WINDOWS.md`](OFFLINE_INSTALL_WINDOWS.md).

```
┌───────────────────────── 운영 서버 (폐쇄망, 127.0.0.1) ─────────────────────────┐
│  Nginx(443) ─► Next.js(3000)                                                    │
│                  ├─► MongoDB        127.0.0.1:27017   (빈 DB로 기동 → 관리자 적재)  │
│                  ├─► LLM(기존 폐쇄망 탑재)  <내부 LLM 주소>  (채팅·비전, 설치 불필요)  │
│                  └─► OCR(RapidOCR)  python venv 또는 127.0.0.1:8091 사이드카       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

리포에 **이미 포함**된 것(반입 불필요): 앱 소스, `public/fonts`(오프라인 폰트), `public/rhwp_bg.wasm`, `tools/hwpx`(순수 stdlib), `tools/ocr`(빌드 레시피), `infra/`(nginx·Modelfile·가드레일).
**별도 조립·반입**이 필요한 것(플랫폼 의존 대용량): Node·`node_modules`·MongoDB·OCR 런타임 → `infra/offline/`.
**LLM(Ollama)·모델은 이미 폐쇄망에 탑재**돼 있다는 전제 — 설치·반입 대상이 아니며, 앱은 `OPENAI_COMPATIBLE_BASE_URL` 로 연결만 한다.

---

## 0. 준비물

- 운영 서버: Ubuntu 24.04 LTS(amd64) **또는** Windows WSL2의 Ubuntu 24.04, Python 3.12(기본 포함), 디스크 여유(수 GB).
- 내부 LLM: Ollama·모델은 **이미 폐쇄망에 탑재**(대상 서버 또는 별도 내부 LLM 서버) — 본 설치는 그 엔드포인트에 **연결만** 한다.
- 조립용 머신: **운영과 동일한 Ubuntu 24.04/amd64**(또는 그 Docker) + 인터넷. OCR 휠·node 네이티브 바이너리가 운영서버와 맞으려면 동일 플랫폼이어야 한다.
- 반입 매체(USB 등).

### 0.1 Windows WSL2 대상 참고
WSL2 배포판이 **Ubuntu 24.04/amd64**이면 본 가이드·번들을 그대로 쓴다. 단:
- **모든 컴포넌트(앱·MongoDB·Ollama·OCR)를 WSL 내부에서** 실행 → `127.0.0.1` 통신이 그대로 성립. (Ollama를 Windows 호스트에 두면 WSL에서 `127.0.0.1`로 접근 불가 → 비권장. 부득이하면 `OPENAI_COMPATIBLE_BASE_URL`을 호스트 IP로.)
- **systemd**: WSL은 기본 비활성. `/etc/wsl.conf`에 `[boot]\nsystemd=true` 추가 후 `wsl --shutdown`으로 재시작하면 §5 systemd 예시 사용 가능. 아니면 스크립트 기본(`mongod --fork`)으로 충분.
- **GPU**: WSL2 CUDA 패스스루로 Ollama GPU 사용 가능(Windows측 NVIDIA 드라이버 필요).
- **반입**: 번들을 Windows에 복사 후 WSL에서 `/mnt/c/...`로 접근하거나 WSL 홈으로 옮긴다.

---

## 1. 오프라인 번들 조립 — [연결된 amd64 머신]

리포를 연결된 머신에 두고:

```bash
bash infra/offline/fetch-offline-bundle.sh
```

`infra/offline/bundle/` 에 다음이 모인다:

| 산출물 | 내용 |
|--------|------|
| `node-v20.*-linux-x64.tar.xz` | Node.js 런타임 |
| `node_modules.tgz` | 앱 의존성(amd64 네이티브 포함) |
| `mongodb-*.tgz` · `mongodb-database-tools-*.tgz` | MongoDB 서버 + mongodump/restore |
| `ocr/wheelhouse/` · `ocr/models_cache/` | OCR 오프라인 휠 + 한국어 PP-OCRv5 모델 |

> LLM(Ollama)·모델은 **번들에 없다** — 이미 폐쇄망에 탑재돼 있으므로 연결만 한다.

> 스크립트 상단 **CONFIG**(Node/Mongo 버전, 모델명)를 환경에 맞게 수정. OCR 상세·대안(venv 통째 반입·Docker)은 [`../tools/ocr/README.md`](../tools/ocr/README.md).

## 2. 반입

`bundle/`(또는 리포 전체)을 운영 서버의 리포 루트로 복사한다. 예: `/opt/ax-playground/`.

## 3. 설치 — [폐쇄망 운영 서버]

리포 루트에서:

```bash
bash infra/offline/install-offline.sh
```

스크립트가 수행: Node 설치 → `node_modules` 복원 → MongoDB 기동(127.0.0.1) → OCR venv(오프라인 휠) 구성. **LLM은 설치하지 않는다**(기존 폐쇄망 탑재 — 연결만). (수동으로 단계별 실행하려면 스크립트 내용을 그대로 따라 하면 된다.)

> MongoDB를 **Docker**로 쓰려면: `docker load < bundle/mongo7-image.tar.gz && docker compose up -d`.

> **초기 데이터는 동봉하지 않는다.** 공개판에는 사규 본문·법령 덤프가 들어 있지 않으므로 앱은 **빈 DB로 기동**하고, 설치 후 관리자 화면에서 직접 적재한다.
> - **사내 사규**: `/admin` → **사규** 탭에서 원본(HWP/HWPX/PDF)을 올려 적재하거나, CLI `npm run reg:ingest -- --file <경로>`. 적재 후 `npm run sagyu:build` 로 `public/sagyu.json` 재생성.
> - **외부 법령·행정규칙**: **법제처 국가법령정보 오픈API로 자체 수집**한다(폐쇄망에서는 실행 불가 — 인터넷 되는 개발망에서 수집 후 md만 반입).
>   `data/laws/md/` 에 `법령_<법령명>.md` · `행정규칙_<규칙명>.md` 형식의 파일을 채우고 폐쇄망에서 `npm run laws:ingest` (`--dry` 로 청킹만 미리보기).
>   md 생성은 `LAW_OC=<법제처에서 발급받은 OC>` 를 설정한 뒤 `node src/scripts/fetch-external-laws.mjs`(수집 대상은 `data/laws/aliases.json` + DB의 사규 그래프 엣지에서 뽑는다) → `node src/scripts/convert-laws-to-md.mjs` 순서로 만든다.
> 자세한 온보딩 순서는 루트 [`../README.md`](../README.md) "초기 데이터 온보딩" 절 참고.

## 4. 환경 변수 — `.env.local`

```bash
cp .env.example .env.local && vi .env.local
```

| 변수 | 필수 | 예시 / 기본 | 설명 |
|------|:---:|------|------|
| `MONGODB_URI` | ✅ | `mongodb://127.0.0.1:27017` | Mongo 연결 |
| `MONGODB_DB` | | `axplayground` | DB명(미설정 시 기본 axplayground, URI 경로보다 우선) |
| `SESSION_SECRET` | ✅ | 32자 이상 랜덤 | iron-session 암호 |
| `ADMIN_ACCESS_KEY` | ✅ | 8자 이상 | `/admin` 접근 키 |

> **기존 Linux 운영 서버 갱신**(소스·RAG만): [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md)
| `OPENAI_COMPATIBLE_BASE_URL` | ✅ | `http://<내부 LLM>:11434/v1` | **기존 폐쇄망 LLM**(OpenAI 호환) 주소 |
| `OPENAI_COMPATIBLE_MODEL` | ✅ | `ax-playground` | 채팅·비전 모델(가드레일 모델 권장) |
| `OPENAI_COMPATIBLE_API_KEY` | | `ollama` | 로컬은 아무 값 |
| `OCR_PROVIDER` | | `python` | `python`(기본) · `http` · `none` |
| `PYTHON_BIN` | | `/opt/axp/ocr/venv/bin/python` | (python) OCR 파이썬 |
| `OCR_URL` | | `http://127.0.0.1:8091/ocr` | (http) OCR 사이드카 |
| `AUDIT_LOG_FILE` | | `/var/log/axp-audit.log` | 감사 로그 파일 |
| `AUDIT_LOG_FULL_TEXT` | | `true` | 입·출력 전문 기록(감리 요건) |
| `REPORT_DIR` | | `/data/reports` | 일일 리포트 출력 |
| `UPLOAD_DIR` | △ | `/var/lib/axplayground/uploads` | 라이브러리 첨부 저장 경로. **배포 디렉토리 밖 영구 경로 권장**(미설정 시 `public/uploads` — 코드 재배포·`git clean` 시 업로드 유실) |
| `HF_HUB_OFFLINE` | | `1` | 외부연결 차단(방어적). 아래 註 참조 |
| `TRANSFORMERS_OFFLINE` | | `1` | 외부연결 차단(방어적). 아래 註 참조 |
| `LAW_API_OC` | | — | (선택) 국가법령 Open API 기관코드 |
| `OLLAMA_EMBEDDING_MODEL` | △ | `bge-m3` | 사규 **의미검색** 임베딩 모델(관리자 설정으로도 지정 가능) |
| `EMBEDDING_DIMENSIONS` | △ | `1024` | 임베딩 차원(bge-m3=1024). 저장된 벡터와 일치해야 함 |
| `OLLAMA_EMBEDDING_BASE_URL` | | `http://<내부 Ollama>:11434` | 임베딩 서버(미설정 시 11434) |

> **외부연결 차단 註** — 앱과 kordoc은 외부 API를 사용하지 않는다(모든 호출은 127.0.0.1/내부망). kordoc에 huggingface 참조가 있으나 이는 **선택 기능인 PDF 수식 OCR**(`--formula-ocr`)이 켜질 때만 ONNX 모델(pix2text-mfd/mfr, ~155MB)을 받는 경로다. 우리 코드의 kordoc 호출(parse·fill·patch) 어디에도 이 플래그가 없어 **트리거되지 않는다**(라이브러리 API도 `formulaOcr` 옵션이 true일 때만 로드). 폐쇄망 원칙상 물리적 봉쇄까지 원하면 `HF_HUB_OFFLINE=1`·`TRANSFORMERS_OFFLINE=1`을 설정하면 어떤 경로로도 다운로드가 차단된다(코드 수정 불필요·무해). 검증: `grep -rn "formula" node_modules/kordoc/dist`로 모듈 존재를 보되, 우리 소스엔 `--formula-ocr`가 없음을 확인.
>
> 사규 RAG는 **키워드($text)+의미(임베딩)+그래프** 하이브리드다([RAG_GRAPHRAG.md](RAG_GRAPHRAG.md)). 의미검색은 Ollama에 임베딩 모델(bge-m3)이 떠 있어야 동작하며, **없으면 자동으로 키워드+그래프만** 사용한다(그레이스풀). 임베딩 on·off·모델은 관리자 설정에서도 제어한다.
>
> **기존 운영 서버 갱신**(재청킹·그래프/임베딩 재빌드분 반영): 전체 `--drop` 복원은 관리자 설정을 덮어쓰므로, RAG 3컬렉션만 교체하는 `scripts/update-rag-db.sh`를 쓴다(코드 재배포 + bge-m3 반입 + 재시작 동반). 절차: [RAG_GRAPHRAG.md §9](RAG_GRAPHRAG.md#9-배포시드--기존-서버-업데이트).

## 5. 빌드 · 기동

```bash
npm run build       # 사규 JSON 생성 + next build (Mongo 기동·복원 이후 실행)
npm run start       # http://127.0.0.1:3000
```

**systemd 등록(권장)** — `/etc/systemd/system/ax-playground.service`:

```ini
[Unit]
Description=AX Playground
After=network.target mongod.service

[Service]
WorkingDirectory=/opt/ax-playground
Environment=PATH=/opt/node/bin:/usr/bin:/bin
ExecStart=/opt/node/bin/npm run start
Restart=always
User=axp

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ax-playground
```

## 6. 인프라 가드레일 (nginx · 감사로그 · cron)

[`../infra/README.md`](../infra/README.md) 절차대로:

1. **LLM(기존 탑재)** — Ollama·모델은 이미 폐쇄망에 있음. 가드레일 모델(`ax-playground`)이 **아직 없으면** LLM 서버에서 `infra/ollama/Modelfile.ax`(FROM=실제 모델)로 `ollama create ax-playground`, **이미 있으면** `OPENAI_COMPATIBLE_MODEL` 만 그 모델명으로 설정. (`SYSTEM` 블록은 `src/lib/guardrails/model/system-prompt.ts` 의 `SECURITY_PREAMBLE` 와 동기화)
1-1. **임베딩 모델(의미검색)** — 사규 의미검색용 `bge-m3`(약 1.2GB)를 내부 Ollama에 반입. 인터넷 머신에서 `ollama pull bge-m3` 후 `~/.ollama/models` 의 해당 blob/manifest를 폐쇄망 Ollama로 복사(또는 내부 레지스트리). 미반입 시 의미검색만 비활성(키워드+그래프는 동작).
2. **Nginx** — `infra/nginx/security.conf` 를 `/etc/nginx/conf.d/` 에 include, `nginx -t && systemctl reload nginx`.
3. **감사 로그** — `/var/log/axp-audit.log` 생성·권한, `REPORT_DIR` 준비.
4. **일일 리포트 cron** — `0 9 * * * cd /opt/ax-playground && npm run report:audit`.

## 7. 검증 체크리스트

- [ ] `curl -I http://127.0.0.1:3000` → 200, 메인 이미지맵 로드
- [ ] `mongosh axplayground --eval "db.rag_regulation.countDocuments()"` → 103
- [ ] `mongosh axplayground --eval "db.rag_vectors.countDocuments()"` → 4320 (의미검색 벡터) · `db.rag_graph_edges.countDocuments()` → 2785 (지식그래프)
- [ ] (의미검색) 내부 Ollama에 임베딩 모델: `curl <Ollama>/api/tags` 에 `bge-m3` 존재 — 없으면 키워드+그래프만 동작
- [ ] 지식검색에서 사규 질의 → 근거 인용 표시(LLM 응답) + "지식그래프" 토글 표출
- [ ] 광고심의에 도안 업로드 → OCR 문구 추출 + 심의 결과(OCR 동작)
- [ ] 안전관리에 현장 사진 → 위험도 분석(비전 모델 동작)
- [ ] `/admin` 키 입력 → 대시보드 진입, 가드레일 탭 표시
- [ ] 감사 로그 파일에 입·출력 기록 누적

## 8. 네트워크 격리 체크리스트

- [ ] MongoDB `127.0.0.1:27017` 루프백 바인딩(docker-compose 반영)
- [ ] 내부 LLM 엔드포인트 도달 가능(내부망 한정) — 앱→LLM 경로만 허용
- [ ] 방화벽 인바운드: 443(직원)·22(관리자)만 허용, 그 외 차단
- [ ] 외부 아웃바운드 차단 — 앱은 외부 API 미사용(로컬 LLM 전용)

## 9. 트러블슈팅

| 증상 | 점검 |
|------|------|
| 빌드 시 사규 JSON 단계 실패 | Mongo 기동·복원 후 `npm run build`(빌드가 DB 참조) |
| AI 응답 없음/오류 | `OPENAI_COMPATIBLE_BASE_URL`(기존 내부 LLM) 도달·방화벽, `OPENAI_COMPATIBLE_MODEL` 모델명 일치 |
| OCR 결과 빈값 | `PYTHON_BIN` 경로, headless OpenCV(`opencv-python-headless`) 설치, 모델 캐시 존재 |
| 한글(HWPX) 생성 오류 | Python3 존재(`tools/hwpx` 는 stdlib), 템플릿 경로 |
| 폰트 깨짐 | `public/fonts` 동봉 확인(오프라인 서브셋) |

