/**
 * 부서검토 패키지 ② 원문 앵커 추출 (mongosh 스크립트)
 *   mongosh --quiet axplayground tools/review-package/extract-articles.js > /tmp/rv/articles.json
 * 온톨로지가 참조하는 모든 조문의 원문을 담아, 패키지 안에서 근거를 바로 대조할 수 있게 한다.
 * 형식: { "문서명#조문명": { c: 분류, t: 전문 } }
 */
const anchors = new Set();
db.ontology_edges.find({ rel: { $in: ["업무근거", "전결", "소관"] } }, { evidence: 1, _id: 0 }).forEach((e) => {
  const ev = e.evidence || {};
  if (ev.doc && ev.name) anchors.add(ev.doc + "#" + ev.name);
});

const out = {};
let miss = 0;
for (const key of anchors) {
  const i = key.indexOf("#");
  const doc = key.slice(0, i), name = key.slice(i + 1);
  const d = db.rag_regulation.findOne({ title: doc }, { category: 1, articles: 1 });
  if (!d) { miss += 1; continue; }
  const a = (d.articles || []).find((x) => x.name === name);
  if (!a || !a.fullText) { miss += 1; continue; }
  out[key] = { c: d.category || "", t: String(a.fullText).slice(0, 12000) };
}
print(JSON.stringify(out));
