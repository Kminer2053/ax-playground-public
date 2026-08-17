<script>
__DATA__
const KEY = "work100-review-v3";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
document.querySelectorAll('.navbtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.navbtn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.dept').forEach(s => { s.hidden = s.dataset.dept !== b.dataset.dept; });
  window.scrollTo({ top: 0 });
}));
const lb = document.getElementById('lb'), lbImg = document.getElementById('lbImg'), lbCap = document.getElementById('lbCap');
document.querySelectorAll('.board-open').forEach(btn => btn.addEventListener('click', () => {
  lbImg.src = BOARDS[btn.dataset.task]; lbCap.textContent = btn.dataset.label + ' — 절차 보드(초안)'; lb.classList.add('open');
}));
const closeLb = () => { lb.classList.remove('open'); lbImg.src = ''; };
document.getElementById('lbClose').addEventListener('click', closeLb);
lb.addEventListener('click', closeLb);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });
// 원문 라이트박스(조문/별표) — 검토자 원문 대조용
const artLb = document.createElement('div'); artLb.className = 'lb'; document.body.appendChild(artLb);
document.addEventListener('click', (e) => {
  const el = e.target.closest('.artlink'); if (!el) return;
  const a = ART[el.dataset.art]; if (!a) return;
  const [doc, name] = el.dataset.art.split('#');
  const q = el.dataset.q || '';
  artLb.innerHTML = '<div class="lb-close">&times;</div><div class="artbox" onclick="event.stopPropagation()">' +
    '<div class="ah">' + (/법령|행정규칙/.test(a.c) ? '<span class="cat">'+a.c+'</span>' : '') + '「' + doc + '」 ' + name + '</div>' +
    (q ? '<div class="aq"><b>근거 인용</b> — ' + q.replace(/</g,'&lt;') + '</div>' : '') +
    '<pre>' + a.t.replace(/</g,'&lt;') + '</pre></div>';
  artLb.classList.add('open');
});
artLb.addEventListener('click', (e) => { if (e.target === artLb || e.target.classList.contains('lb-close')) artLb.classList.remove('open'); });
function applyCard(rev, v) { const c = rev.closest('.task'); c.classList.toggle('reviewed-ok', v === 'ok'); c.classList.toggle('reviewed-fix', v === 'fix'); }
document.querySelectorAll('.review').forEach(rev => {
  const task = rev.dataset.task, saved = store[task];
  if (saved) { if (saved.verdict) { const r = rev.querySelector('input[value="'+saved.verdict+'"]'); if (r) r.checked = true; applyCard(rev, saved.verdict); } if (saved.note) rev.querySelector('.rnote').value = saved.note; }
  const save = () => {
    const verdict = rev.querySelector('input:checked')?.value || "", note = rev.querySelector('.rnote').value.trim();
    if (!verdict && !note) delete store[task]; else store[task] = { dept: rev.dataset.dept, verdict, note };
    localStorage.setItem(KEY, JSON.stringify(store)); applyCard(rev, verdict); updateSaved(rev.dataset.dept);
  };
  rev.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', save));
  rev.querySelector('.rnote').addEventListener('input', save);
});
function updateSaved(dept) {
  const total = document.querySelectorAll('.dept[data-dept="'+CSS.escape(dept)+'"] .task').length;
  const done = Object.values(store).filter(v => v.dept === dept && v.verdict).length;
  const el = document.querySelector('.saved[data-dept="'+CSS.escape(dept)+'"]');
  if (el && !el.dataset.msg) el.textContent = done ? done + "/" + total + " 확인됨" : "";
  const nb = document.querySelector('.navbtn[data-dept="'+CSS.escape(dept)+'"]');
  if (nb) nb.classList.toggle('done', done === total && total > 0);
}
// 부서 목록은 빌드된 문서(<section class="dept" data-dept="…">)에서 읽는다 — 기관별 부서명을 코드에 박지 않는다.
[...new Set([...document.querySelectorAll('.dept[data-dept]')].map(el => el.dataset.dept))].forEach(updateSaved);
function collectDept(dept) {
  const rows = [];
  document.querySelectorAll('.dept[data-dept="'+CSS.escape(dept)+'"] .task').forEach(card => {
    const s = store[card.dataset.task] || {};
    rows.push({ 업무: card.querySelector('h3').textContent, taskId: card.dataset.task, verdict: s.verdict || "", 판정: s.verdict === 'ok' ? '맞음' : s.verdict === 'fix' ? '수정필요' : '미확인', 의견: s.note || "" });
  });
  return rows;
}
document.querySelectorAll('.exp').forEach(btn => btn.addEventListener('click', () => {
  const dept = btn.dataset.dept;
  const blob = new Blob([JSON.stringify({ 부서: dept, 검토일시: new Date().toISOString(), 항목: collectDept(dept) }, null, 2)], { type: "application/json" });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "업무검토_" + dept + ".json"; a.click();
}));
/* ── 의견서 PDF 저장 ───────────────────────────────────────────────
   폐쇄망이라 서버도 외부 PDF 라이브러리도 쓸 수 없다. 브라우저 인쇄의 "PDF로 저장"이
   한글이 깨지지 않는 유일하게 확실한 경로다(Chrome·Edge 기본 기능).
   화면은 그대로 두고, 인쇄 시점에만 제출용 문서를 만들어 끼운다. */
function buildSheet(dept, author) {
  const items = collectDept(dept).filter(i => i.verdict);
  const rows = items.map((i, n) => (
    '<tr><td class="n">' + (n + 1) + '</td><td>' + esc(i.업무) + '</td>' +
    '<td class="v ' + i.verdict + '">' + i.판정 + '</td>' +
    '<td class="op">' + (esc(i.의견) || '<span class="dim">—</span>') + '</td></tr>'
  )).join('');
  const d = new Date();
  const stamp = d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  const fix = items.filter(i => i.verdict === 'fix').length;
  return '' +
    '<div class="sheet-head"><h1>업무체계 검토 의견서</h1>' +
    '<p class="sub">AX Playground · 업무100 부서 검토</p></div>' +
    '<table class="meta"><tr><th>부서</th><td>' + esc(dept) + '</td>' +
    '<th>작성자</th><td>' + (esc(author) || '—') + '</td></tr>' +
    '<tr><th>작성일</th><td>' + stamp + '</td>' +
    '<th>검토 건수</th><td>확인 ' + items.length + '건 (수정필요 ' + fix + '건)</td></tr></table>' +
    '<table class="sheet"><thead><tr><th class="n">#</th><th>업무</th><th class="v">판정</th><th class="op">의견</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<p class="foot">규정 원문(직제세칙 별표6·별표7, 위임전결규정 별표1)에서 재구성한 업무 체계에 대한 부서 확인 결과입니다.</p>';
}
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.querySelectorAll('.pdf').forEach(btn => btn.addEventListener('click', () => {
  const dept = btn.dataset.dept;
  const row = btn.closest('.dactions');
  const author = row.querySelector('.author').value.trim();
  const status = row.querySelector('.saved');
  const setMsg = (m, err) => { status.dataset.msg = "1"; status.className = 'saved' + (err ? ' suberr' : ''); status.textContent = m; };
  const items = collectDept(dept).filter(i => i.verdict);
  if (!items.length) { setMsg('확인한 업무가 없습니다', true); return; }
  if (!author) { setMsg('작성자명을 입력하세요', true); return; }

  let sheet = document.getElementById('printSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.appendChild(sheet); }
  sheet.innerHTML = buildSheet(dept, author);
  document.body.classList.add('printing');
  setMsg('인쇄 창에서 "대상"을 PDF로 저장으로 고르세요');

  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);   // 스타일 적용 후 인쇄
}));
</script></body></html>