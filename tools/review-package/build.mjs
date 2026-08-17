/**
 * 부서검토 패키지 ③ 빌더 — 단일 HTML(외부 리소스 0) 생성.
 *
 * 폐쇄망 내부망 PC에서 그대로 열리도록 데이터·원문·보드 SVG를 모두 인라인한다.
 * 산출물(html·zip)은 리포에 저장하지 않는다 — 이 스크립트만 보존한다.
 *
 * 사용:
 *   mkdir -p /tmp/rv
 *   mongosh --quiet axplayground tools/review-package/extract.js          > /tmp/rv/data.json
 *   mongosh --quiet axplayground tools/review-package/extract-articles.js > /tmp/rv/articles.json
 *   node tools/review-package/build.mjs /tmp/rv/data.json /tmp/rv/articles.json /tmp/rv/index.html
 *
 * 템플릿 3종(template-head.html · template-shell.html · template-script.js)은 같은 폴더에 둔다.
 * 스크립트 템플릿의 `__DATA__` 자리에 BOARDS·ART 상수가 주입된다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const [dataPath, artPath, outPath] = process.argv.slice(2);
if (!dataPath || !artPath || !outPath) {
  console.error("사용: node build.mjs <data.json> <articles.json> <out.html>");
  process.exit(1);
}

const T = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const ART = JSON.parse(fs.readFileSync(artPath, "utf8"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 상태 배지 — 온톨로지 수명주기(검토요망 → 원문확인 → 승격) */
const stBadge = (st) => {
  const m = { validated: ["원문확인", "val"], promoted: ["승격", "pro"], candidate: ["검토요망", "cand"] };
  const [t, c] = m[st] ?? [st ?? "", "cand"];
  return `<span class="st ${c}">${esc(t)}</span>`;
};
/** 생성 방법 배지 — 검토자가 신뢰도를 구분하도록 rule/manual은 확정, llm만 AI추정으로 표기 */
const mBadge = (b) =>
  b.basis === "전결" || b.m === "rule" ? '<span class="mchip rule">규정확정</span>'
  : b.m === "manual" ? '<span class="mchip rule">원문확인</span>'
  : '<span class="mchip ai">AI추정</span>';

const DOMAIN_HUE = {
  "경영지원": "#b4540a", "재무·계약": "#a8551c", "영업·상품": "#6a41b5",
  "광고·홍보": "#c0651f", "안전·시설": "#0f766e", "감사·정보": "#2f6fb0",
};
const hue = (fn) => DOMAIN_HUE[String(fn || "").split(">")[0].trim()] ?? "#6b5d47";

function card(t, idx, dept, gi) {
  const flow = (t.steps || []).length
    ? `<div class="flow">${t.steps.map((s) => `<span>${esc(s)}</span>`).join("<i>›</i>")}</div>` : "";
  const hq = t.linkedToHQ ? `<div class="hq">↳ 본사 연계: ${esc(t.linkedToHQ)}</div>` : "";

  const own = (t.ownership || []).length
    ? (t.ownership || []).map((o) => `<div class="own-dept">${esc(o.dept)}</div><ul class="quotes">${
        (o.quotes || []).map((q) => `<li>${stBadge(q.st)}<span class="artlink" data-art="직제규정 시행세칙#별표 제6호 (본사 부서별 분장업무)" data-q="${esc(q.q)}" title="분장 별표 원문 보기">${esc(q.q)} <i>↗</i></span></li>`).join("")
      }</ul>`).join("")
    : `<div class="none">소관 미도출 <em>(검토 큐)</em></div>`;

  const appr = (t.approval || []).length
    ? `<ul class="appr">${(t.approval || []).map((a) => `<li>${stBadge(a.st)}<span class="pos">${esc(a.pos)}</span>${
        a.limit ? `<span class="limit">${esc(a.limit)}</span>` : '<span class="limit none">한도 명시 없음</span>'
      }<span class="q artlink" data-art="위임전결규정#별표 제1호 (전결사항)" data-q="${esc(a.q)}" title="전결 별표 원문 보기">${esc(a.q)} <i>↗</i></span></li>`).join("")}</ul>`
    : `<div class="none">전결 없음 <em>(위임전결 별표1 미해당)</em></div>`;

  const basis = (t.basis || []).length
    ? `<ul class="basis">${(t.basis || []).map((b) => `<li>${stBadge(b.st)}${mBadge(b)}<span class="doc artlink" data-art="${esc(b.doc)}#${esc(b.name)}" title="조문 원문 보기">「${esc(b.doc)}」 ${esc(b.name)} <i>↗</i></span>${
        b.basis ? `<span class="bkind">${esc(b.basis)}</span>` : ""
      }</li>`).join("")}</ul>`
    : `<div class="none">근거 미도출 <em>(검토 큐)</em></div>`;

  // 스크립트 규약: .board-open + data-task/data-label (BOARDS[id]로 조회)
  const boardBtn = t.svg ? `<button class="board-open" data-task="${esc(t.id)}" data-label="${esc(t.label)}">▤ 절차 보드 보기</button>` : "";

  return `<article class="task" data-task="${esc(t.id)}">
    <div class="thead">
      <div class="tmeta"><span class="fnb" style="--h:${hue(t.fn)}">${esc(t.fn)}</span>${stBadge(t.status)}</div>
      <div class="trow"><h3>${esc(t.label)}</h3><div class="tnum">${idx}</div></div>
      <p class="desc">${esc(t.desc)}</p>
      ${flow}
      ${hq}
    </div>
    <div class="facts">
      <div class="fact"><div class="k">소관 <small>어느 부서 업무인가</small></div><div class="v">${own}</div></div>
      <div class="fact"><div class="k">전결 <small>누가 결재하는가·한도</small></div><div class="v">${appr}</div></div>
      <div class="fact"><div class="k">근거 <small>근거 규정·조문</small></div><div class="v">${basis}</div></div>
    </div>
    <div class="tfoot">${boardBtn}
      <div class="review" data-task="${esc(t.id)}" data-dept="${esc(dept)}">
        <span class="rlabel">확인:</span>
        <label class="ropt ok"><input type="radio" name="r_${gi}_${idx}" value="ok"> 맞음</label>
        <label class="ropt fix"><input type="radio" name="r_${gi}_${idx}" value="fix"> 수정필요</label>
        <input type="text" class="rnote" placeholder="수정 의견(선택)" />
      </div>
    </div>
  </article>`;
}

// 부서 탭 — 소관 부서 기준, 업무 수 많은 순
const byDept = new Map();
for (const t of T) {
  const d = t.dept || "(미지정)";
  if (!byDept.has(d)) byDept.set(d, []);
  byDept.get(d).push(t);
}
const depts = [...byDept.entries()].sort((a, b) => b[1].length - a[1].length);

// 본사 부서 먼저, 현업(지역본부 계열) 뒤로 — 원본 셸의 navbtn/field 클래스 규약 유지
const isField = (d) => /본부/.test(d);
depts.sort((a, b) => (isField(a[0]) - isField(b[0])) || (b[1].length - a[1].length));
const nav = depts.map(([d, list], i) =>
  `<button class="navbtn${i === 0 ? " active" : ""}${isField(d) ? " field" : ""}" data-dept="${esc(d)}">${esc(d)}<em>${list.length}</em></button>`).join("");
const panels = depts.map(([d, list], i) => {
  const gi = i;
  const field = isField(d);
  return `<section class="dept" data-dept="${esc(d)}"${i === 0 ? "" : " hidden"}>
    <div class="dhead">
      <div>
        <div class="eyebrow">${field ? "현업 소속 검토" : "본사 부서 검토"} · ${esc(d)}</div>
        <h2>${esc(d)} <span class="cnt">업무 ${list.length}</span></h2>
        <p class="dnote">각 업무의 <b>소관·전결·근거</b>가 실제와 맞는지 확인해 주세요. 회색 인용은 규정 별표 원문 그대로이며, <b class="ai-hi">AI추정</b>·<span class="st cand" style="vertical-align:baseline">검토요망</span>은 특히 확인이 필요합니다.</p>
      </div>
      <div class="dactions">
        <input type="text" class="author" placeholder="작성자(성명/직위)" data-dept="${esc(d)}" />
        <button class="pdf" data-dept="${esc(d)}">의견서 PDF로 저장</button>
        <button class="exp" data-dept="${esc(d)}">데이터로 내려받기</button>
        <span class="saved" data-dept="${esc(d)}"></span>
      </div>
    </div>
    <div class="cards">${list.map((t, k) => card(t, k, d, gi)).join("")}</div>
  </section>`;
}).join("");
const hq = T.filter((t) => t.org !== "현업").length;

const boards = {};
for (const t of T) if (t.svg) boards[t.id] = "data:image/svg+xml;base64," + Buffer.from(t.svg, "utf8").toString("base64");

const head = fs.readFileSync(path.join(DIR, "template-head.html"), "utf8");
const shell = fs.readFileSync(path.join(DIR, "template-shell.html"), "utf8");
const script = fs.readFileSync(path.join(DIR, "template-script.js"), "utf8");
const tail = fs.readFileSync(path.join(DIR, "template-tail.html"), "utf8"); // 보드 라이트박스(#lb/#lbImg/#lbClose)

const dataBlock = `const BOARDS = ${JSON.stringify(boards)};\nconst ART = ${JSON.stringify(ART)};`;
const html = head
  + shell.replace("__NAV__", nav)
         .replaceAll("__COUNT__", String(T.length))
         .replace("__HQ__", String(hq))
         .replace("__FIELD__", String(T.length - hq))
         .replace("__DEPTS__", String(depts.length))
  + panels
  + tail
  + script.replace("__DATA__", dataBlock);

fs.writeFileSync(outPath, html);
console.log(`작성 ${outPath} · ${(html.length / 1048576).toFixed(2)} MB · 업무 ${T.length} · 보드 ${Object.keys(boards).length} · 탭 ${depts.length} · 원문 ${Object.keys(ART).length}`);
