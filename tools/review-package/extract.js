/**
 * 부서검토 패키지 ① 데이터 추출 (mongosh 스크립트)
 *   mongosh --quiet axplayground tools/review-package/extract.js > /tmp/rv/data.json
 * 온톨로지 Task와 소관·전결·업무근거 엣지, 보드 렌더캐시 SVG를 패키지 빌더가 쓰는 형태로 뽑는다.
 */
const tasks = db.ontology_nodes.find({ type: "Task" }, { id: 1, label: 1, status: 1, props: 1, _id: 0 }).toArray();
const boards = {};
db.work100_boards.find({}, { taskId: 1, svg: 1, _id: 0 }).forEach((b) => { boards[b.taskId] = b.svg || ""; });

const out = tasks.map((t) => {
  const p = t.props || {};
  const own = {};
  const addOwn = (dept, e) => {
    const key = String(dept || "").replace(/^dept:/, "");
    (own[key] = own[key] || []).push({ q: (e.evidence || {}).quote || (e.evidence || {}).name || "", st: e.status });
  };
  db.ontology_edges.find({ rel: "소관", to: t.id }).forEach((e) => addOwn(e.from, e));
  db.ontology_edges.find({ rel: "소관", from: t.id }).forEach((e) => addOwn(e.to, e));

  const approval = db.ontology_edges.find({ rel: "전결", from: t.id }).toArray().map((e) => ({
    pos: (e.props || {}).pos || "", limit: (e.props || {}).limit ?? null,
    scope: (e.props || {}).scope || "", q: (e.evidence || {}).quote || "", st: e.status,
  }));
  // m = 생성 방법(rule=규정확정 · manual=원문확인 · llm=AI추정) — 검토자가 신뢰도를 구분하는 배지 근거
  const basis = db.ontology_edges.find({ rel: "업무근거", from: t.id }).toArray().map((e) => ({
    doc: (e.evidence || {}).doc || "", name: (e.evidence || {}).name || "",
    basis: (e.props || {}).basis || "", m: (e.provenance || {}).method || "", st: e.status,
  }));
  return {
    id: t.id, label: t.label, status: t.status || "candidate", desc: p.desc || "",
    dept: p.dept || "", org: p.org || "본사", fn: p.fn || "", steps: p.steps || [],
    linkedToHQ: p.linkedToHQ || null,
    ownership: Object.entries(own).map(([dept, quotes]) => ({ dept, quotes })),
    approval, basis, svg: boards[t.id] || "",
  };
});
print(JSON.stringify(out));
