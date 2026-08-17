/**
 * 임의양식 실서식 코퍼스 품질 루프(P4) — 서식×가상 시나리오 → 생성 → 자동 채점.
 *   npx tsx src/scripts/eval-form-corpus.ts --gen          # 주입용 참고자료 hwpx 생성(시나리오)
 *   npx tsx src/scripts/eval-form-corpus.ts --run [tag]    # 실서버(:3000) 경유 전량 실행·채점
 *
 * 코퍼스(로컬 실서식 + 정부 공개 서식 — 리포 미포함, CORPUS_DIR 참조):
 *   채움 검증 5종(신청서·보고서: 골든 라벨→기대값 채점) + 무결성 앵커 1종(작성 완료 문서: 훼손 0이 정답).
 * 지표: fill(골든 반영률) · misplace(오배치) · damage(원본 셀 접두조각화·소실) · struct(블록/표행렬) · echo(복창).
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import fs from "fs";
import { markdownToHwpx, openHwpxDocument } from "kordoc";

const CORPUS_DIR = process.env.CORPUS_DIR || path.join(process.cwd(), "data/tmp/corpus");
const DL = process.env.LOCAL_FORMS_DIR || path.join(process.cwd(), "data/tmp/forms"); // 로컬 실서식 hwpx 보관 폴더(리포 미포함)
const API = process.env.DOCS_API || "http://127.0.0.1:3000/api/docs/generate";

type Gold = { label: string; expect: string[]; where?: "near" | "any" }; // 라벨 문맥 셀(또는 인접)에 기대 토큰
type Case = {
  id: string;
  form: string; // 서식 hwpx 경로
  kind: "fill" | "anchor"; // anchor = 무결성(변경 최소·훼손 0)
  instruction: string;
  refMd?: string; // 주입용 참고자료(hwpx로 생성)
  golds: Gold[];
  mustBody?: string[]; // 본문 어딘가 포함(placeholder 교체 등)
};

const CASES: Case[] = [
  {
    id: "busan-지원금신청서", form: `${CORPUS_DIR}/busan_2.hwpx`, kind: "fill",
    instruction: "첨부 참고자료의 신청인 정보로 고유가 피해지원금 신청서를 작성해줘. 주민등록번호·계좌 등 참고자료에 없는 항목은 비워 둬.",
    refMd: `# 고유가 피해지원금 신청 준비 메모\n\n신청인은 김하늘이며, 연락 가능한 전화번호는 010-4321-8765입니다.\n주소는 부산광역시 연제구 중앙대로 1001(연산동)입니다.\n전자우편 주소는 haneul.kim@example.com 을 사용합니다.\n신청 일자는 2026년 7월 10일로 기재합니다.`,
    golds: [
      { label: "성명", expect: ["김하늘"] },
      { label: "전화번호", expect: ["[PHONE]"] }, // 보안 정책: 실값 대신 자리표시 + 사용자 직접 입력
      { label: "주소", expect: ["연제구", "중앙대로"] },
      { label: "전자우편", expect: ["[EMAIL]"] },
    ],
  },
  {
    id: "seoul-보고서서식", form: `${CORPUS_DIR}/seoul_F0000056354070.hwpx`, kind: "fill",
    instruction: "첨부 참고자료를 바탕으로 이 보고서(계획서) 서식을 채워줘. 표지의 보고서 제목·보고일자·부서명과 본문 개요를 참고자료 내용으로 작성.",
    refMd: `# 보고서 작성 기초자료\n\n보고서 제목은 "2026년 하반기 역사 편의시설 개선 계획"입니다.\n보고일자는 2026. 7. 10.(금)입니다.\n작성 부서는 시설관리처입니다.\n\n## 개요\n전국 주요 역사 37곳의 수유실·수면캡슐·물품보관함을 하반기 중 단계적으로 개선합니다.\n1단계(7~8월)는 수도권 12개 역, 2단계(9~11월)는 지방 25개 역이 대상입니다.\n총 소요예산은 12억 5천만원입니다.`,
    golds: [
      { label: "제목", expect: ["편의시설 개선"] },
      { label: "보고일자", expect: ["7. 10", "2026"], where: "any" },
    ],
    mustBody: ["37", "수유실"],
  },
  {
    id: "seoul-시행문", form: `${CORPUS_DIR}/seoul_F0000056354069.hwpx`, kind: "fill",
    instruction: "이 시행문 본문을 'AI 문서작성 도구 전사 사용 안내'로 다시 작성해줘. 요지: 1) 7월 14일부터 전 부서에서 AX 플레이그라운드 문서작성 기능 사용 가능 2) 표준양식·임의양식 모두 지원 3) 문의는 정보화부서.",
    golds: [],
    mustBody: ["AX 플레이그라운드", "정보화부서"],
  },
  {
    id: "양성과정-신청서", form: `${DL}/양성과정_신청서.hwpx`, kind: "fill",
    instruction: "첨부 참고자료의 신청자 정보로 양성과정 신청서를 채워줘. 참고자료에 없는 항목은 비워 둬.",
    refMd: `# 양성과정 신청 정보\n\n신청자는 유통사업처 소속 이도윤 과장입니다.\n사번은 20180427이고, 연락처는 010-9876-1234입니다.\n신청 과정은 "AI·데이터분석 전문인재 양성과정(기본)"입니다.\n신청 사유: 매장 매출 데이터 분석과 수요예측 업무에 AI 역량이 필요하며, 하반기 전문점 상권분석 프로젝트에 적용할 계획입니다.`,
    golds: [
      { label: "성명", expect: ["이도윤"] },
      { label: "소속", expect: ["유통사업처"] },
      { label: "사유", expect: ["상권분석", "수요예측"], where: "any" }, // 대형 작성란(라벨 원거리) — 존재 판정
    ],
  },
  {
    id: "조달청-연장신청서", form: `${DL}/[별지 3의1] 우수제품지정기간연장신청서(우수조달물품 지정관리 규정 ).hwpx`, kind: "fill",
    instruction: "첨부 참고자료로 우수제품 지정기간 연장신청서를 작성해줘.",
    refMd: `# 연장신청 기초자료\n\n신청 업체명은 주식회사 한빛테크입니다. 대표자는 박서준입니다.\n대상 제품명은 "스마트 안전모(HB-500)"이며 우수제품 지정번호는 제2024-123호입니다.\n지정기간 연장 신청 사유: 조달 수요가 지속되고 있고, 2026년 상반기 납품 실적이 8억 2천만원으로 전년 대비 35% 증가했습니다.`,
    golds: [
      { label: "회사명", expect: ["한빛테크"] },
      { label: "우수제품명", expect: ["스마트 안전모"] },
      { label: "판매실적", expect: ["35%", "8억"] },
    ],
  },
  {
    id: "앵커-보안검토서", form: `${DL}/보안성_검토_요청서.hwpx`, kind: "anchor",
    instruction: "이 보안성 검토 요청서 내용을 최신화해줘.",
    golds: [],
  },
];

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

async function gen(): Promise<void> {
  for (const c of CASES) {
    if (!c.refMd) continue;
    const out = await markdownToHwpx(c.refMd);
    const p = `${CORPUS_DIR}/ref_${c.id}.hwpx`;
    const bytes = (out as { bytes?: Uint8Array }).bytes ?? (out as unknown as Uint8Array);
    fs.writeFileSync(p, Buffer.from(bytes));
    console.log("주입 hwpx:", p);
  }
}

type CellSnap = { bi: number; r: number; c: number; text: string }[];
async function snapCells(bytes: Uint8Array): Promise<{ cells: CellSnap; bodies: string[]; blocks: number; grids: string }> {
  const d = await openHwpxDocument(bytes);
  const blocks = d.blocks as { type?: string; text?: string; table?: { rows?: number; cols?: number; cells?: { text?: string }[][] } }[];
  const cells: CellSnap = [];
  const bodies: string[] = [];
  const grids: string[] = [];
  blocks.forEach((b, bi) => {
    if (b.table?.cells) {
      grids.push(`${bi}:${b.table.rows}x${b.table.cols}`);
      b.table.cells.forEach((row, r) => row.forEach((cell, cc) => cells.push({ bi, r, c: cc, text: String(cell.text ?? "") })));
    } else if (b.text) bodies.push(String(b.text));
  });
  return { cells, bodies, blocks: blocks.length, grids: grids.join(",") };
}

async function callApi(c: Case): Promise<{ bytes: Uint8Array | null; note: string }> {
  const fd = new FormData();
  fd.set("format", "custom");
  fd.set("instruction", c.instruction);
  fd.append("files", new File([new Uint8Array(fs.readFileSync(c.form))], path.basename(c.form))); // 양식
  const refP = `${CORPUS_DIR}/ref_${c.id}.hwpx`;
  if (c.refMd && fs.existsSync(refP)) fd.append("files", new File([new Uint8Array(fs.readFileSync(refP))], `참고_${c.id}.hwpx`));
  let res = await fetch(API, { method: "POST", body: fd });
  let j = (await res.json()) as { fileBase64?: string; preview?: string; error?: string; data?: { __form?: boolean; fields?: { label: string; value: string }[] } };
  // 폼 분기: 제안값 검토 응답 → 그대로 확정(build)
  if (!j.fileBase64 && j.data?.__form && Array.isArray(j.data.fields)) {
    const fd2 = new FormData();
    fd2.set("format", "custom");
    fd2.set("instruction", c.instruction);
    fd2.set("stage", "build");
    fd2.set("data", JSON.stringify({ fields: j.data.fields }));
    fd2.append("files", new File([new Uint8Array(fs.readFileSync(c.form))], path.basename(c.form)));
    if (c.refMd && fs.existsSync(refP)) fd2.append("files", new File([new Uint8Array(fs.readFileSync(refP))], `참고_${c.id}.hwpx`));
    res = await fetch(API, { method: "POST", body: fd2 });
    j = (await res.json()) as typeof j;
  }
  if (!j.fileBase64) return { bytes: null, note: (j.error ?? j.preview ?? "산출물 없음").slice(0, 140) };
  return { bytes: new Uint8Array(Buffer.from(j.fileBase64, "base64")), note: (j.preview ?? "").slice(0, 140) };
}

async function preflight(): Promise<void> {
  const fd = new FormData();
  fd.set("format", "custom"); fd.set("stage", "detect");
  fd.append("files", new File([new Uint8Array(fs.readFileSync(`${CORPUS_DIR}/seoul_F0000056354070.hwpx`))], "canary.hwpx"));
  const j = (await (await fetch(API, { method: "POST", body: fd })).json()) as { flowVersion?: string };
  const want = "custom-form-v5";
  if (j.flowVersion !== want) {
    console.error(`✗ 서버 스테일: flowVersion=${j.flowVersion ?? "(없음)"} (기대 ${want}) — dev 서버가 최신 코드를 물지 않았습니다. 재시작 후 재실행하세요.`);
    process.exit(2);
  }
  console.log(`카나리아 OK(${want})`);
}

async function run(tag: string): Promise<void> {
  await preflight();
  const report: Record<string, unknown>[] = [];
  for (const c of CASES) {
    if (!fs.existsSync(c.form)) { console.log(`✗ ${c.id}: 서식 없음`); continue; }
    const orig = await snapCells(new Uint8Array(fs.readFileSync(c.form)));
    const r = await callApi(c);
    if (!r.bytes) {
      // 무결성 앵커에서 '작성 완료 문서 — 재작성 미지원' 정직 거부는 파괴 방지의 올바른 동작 = 통과
      const honest = c.kind === "anchor" && /작성 완료된 문서|재작성은 지원하지 않습니다/.test(r.note);
      console.log(`${honest ? "✅" : "✗"} ${c.id}: ${r.note.slice(0, 90)}`);
      report.push({ id: c.id, kind: c.kind, honestReject: honest, note: r.note });
      continue;
    }
    const out = await snapCells(r.bytes);
    fs.writeFileSync(`${CORPUS_DIR}/out_${tag}_${c.id}.hwpx`, Buffer.from(r.bytes));

    // 구조
    const structOk = orig.blocks === out.blocks && orig.grids === out.grids;
    // 훼손: ①접두 조각화 ②카탈로그 복창 오염(현재="…") ③앵커의 모든 셀 변경
    const outMap = new Map(out.cells.map((x) => [`${x.bi}:${x.r}:${x.c}`, x.text]));
    let damage = 0;
    const damaged: string[] = [];
    for (const cell of orig.cells) {
      const before = norm(cell.text);
      if (before.length < 12) continue;
      const after = norm(outMap.get(`${cell.bi}:${cell.r}:${cell.c}`) ?? "");
      if (after && after.length < before.length && before.startsWith(after)) { damage++; damaged.push(cell.text.slice(0, 22)); }
      if (after.includes(norm('현재="'))) { damage++; damaged.push("복창오염:" + cell.text.slice(0, 16)); }
      if (c.kind === "anchor" && after !== before) { damage++; damaged.push("앵커변경:" + cell.text.slice(0, 16)); }
    }
    // 골든: 기대 토큰이 산출물 전체에 존재 + 라벨 인접(같은 표) 배치인지
    const allText = norm([...out.cells.map((x) => x.text), ...out.bodies].join(" "));
    let fillHit = 0, misplace = 0;
    const missed: string[] = [];
    for (const g of c.golds) {
      const hit = g.expect.every((e) => allText.includes(norm(e)));
      if (!hit) { missed.push(g.label); continue; }
      // 배치: 기대 토큰 중 하나가 라벨과 같은 표 블록에 있는가
      if (g.where === "any") { fillHit++; continue; }
      const labelCells = out.cells.filter((x) => norm(x.text).includes(norm(g.label)));
      const near = labelCells.some((lc) => out.cells.some((x) => x.bi === lc.bi && g.expect.some((e) => norm(x.text).includes(norm(e)))));
      if (near) fillHit++; else { misplace++; missed.push(`${g.label}(오배치)`); }
    }
    const bodyOk = (c.mustBody ?? []).filter((m) => allText.includes(norm(m))).length;
    const row = {
      id: c.id, kind: c.kind, note: r.note,
      struct: structOk, damage, damaged: damaged.slice(0, 3),
      fill: `${fillHit}/${c.golds.length}`, misplace, missed,
      body: c.mustBody ? `${bodyOk}/${c.mustBody.length}` : "-",
    };
    report.push(row);
    const bodyAll = !c.mustBody || bodyOk === c.mustBody.length;
    const flag = c.kind === "anchor"
      ? (structOk && damage === 0 ? "✅" : "❌")
      : (structOk && damage === 0 && misplace === 0 && fillHit === c.golds.length && bodyAll ? "✅" : "△");
    console.log(`${flag} ${c.id} | 구조 ${structOk ? "OK" : "✗"} · 훼손 ${damage} · fill ${row.fill} · 오배치 ${misplace} · body ${row.body} | ${r.note.slice(0, 60)}`);
    if (missed.length) console.log(`    미충족: ${missed.join(", ")}`);
  }
  fs.writeFileSync(`${CORPUS_DIR}/report_${tag}.json`, JSON.stringify(report, null, 1));
  console.log(`\n리포트: ${CORPUS_DIR}/report_${tag}.json`);
}

const mode = process.argv[2];
if (mode === "--gen") gen().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "--run") run(process.argv[3] || "base").catch((e) => { console.error(e); process.exit(1); });
else console.log("사용: --gen | --run [tag]");
