/**
 * 표 성격 전수 분류 — 리포트(검수시트 HTML/CSV) 및 DB 저장.
 *   MONGODB_URI=... npx tsx src/scripts/classify-tables.ts            # 분포·assert·검수시트 생성
 *   MONGODB_URI=... npx tsx src/scripts/classify-tables.ts --apply    # articles[].tableKind/tableConf 저장
 * 검수시트는 로컬 파일로만 생성(사규 내용 포함 — 외부 업로드 금지).
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { classifyTableChunk, type TableClass } from "@/lib/regulations-table-classify";
import { collectionName } from "@/lib/collections";

type Row = Omit<TableClass, "conf"> & { conf: TableClass["conf"] | "확정"; doc: string; name: string; len: number; preview: string };

// 사람 검수 확정(검수시트 회신) — 규칙보다 우선, 재태깅·재적재에도 영속
const OVERRIDES_PATH = "data/table-overrides.json";
function loadOverrides(): Map<string, "A" | "B" | "C" | "D"> {
  try {
    const arr = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8")) as { doc: string; name: string; kind: "A" | "B" | "C" | "D" }[];
    return new Map(arr.map((o) => [`${o.doc}\u0000${o.name}`, o.kind]));
  } catch { return new Map(); }
}
const APPLY = process.argv.includes("--apply");
const OUT_DIR = process.env.TABLE_REVIEW_DIR || "backups";

// 알려진 정답 케이스(회귀 가드)
const ASSERTS: { doc: RegExp; name: RegExp; expect: string }[] = [
  { doc: /위임전결/, name: /별표 제1호/, expect: "A" },
  { doc: /상벌운영/, name: /별표 제2호 \(징계양정/, expect: "A" },
  { doc: /이해충돌/, name: /별표 제2호/, expect: "A" },
  { doc: /계약업무/, name: /별표 제19호/, expect: "A" },
  { doc: /자원유통/, name: /점검표/, expect: "B" },
  { doc: /계약업무/, name: /별지 제34호/, expect: "B" },
  { doc: /계약업무/, name: /별표 제13호 \(용역계약일반조건\)/, expect: "C" },
  { doc: /행정정보시스템/, name: /종합체계도/, expect: "C" },
  { doc: /직제 규정/, name: /^부칙/, expect: "D" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  await connectDb();
  const col = mongoose.connection.db!.collection(collectionName("ragRegulation"));
  const docs = await col.find({}, { projection: { title: 1, articles: 1 } }).toArray();

  const overrides = loadOverrides();
  let fixed = 0;
  const rows: Row[] = [];
  let total = 0;
  for (const d of docs) {
    const arts = d.articles as { name: string; fullText?: string }[];
    for (const a of arts) {
      total++;
      const c = classifyTableChunk(a.name, a.fullText ?? "");
      if (!c) continue;
      const pipe = (a.fullText ?? "").split("\n").filter((l) => l.trimStart().startsWith("|")).slice(0, 4).join("\n");
      const row: Row = { ...c, doc: d.title as string, name: a.name, len: (a.fullText ?? "").length, preview: pipe.slice(0, 400) };
      const ov = overrides.get(`${row.doc}\u0000${row.name}`);
      if (ov) { row.kind = ov; row.conf = "확정"; row.signals = [...row.signals, "사람확정"]; fixed++; }
      rows.push(row);
    }
  }
  if (overrides.size) console.log(`사람 확정 오버라이드: ${fixed}/${overrides.size}건 매칭`);

  // 분포
  const cnt = (k: string) => rows.filter((r) => r.kind === k).length;
  const low = rows.filter((r) => r.conf === "하");
  console.log(`전체 청크 ${total.toLocaleString()} · 표 포함 ${rows.length}`);
  console.log(`A 기준표 ${cnt("A")} · B 서식표 ${cnt("B")} · C 본문표 ${cnt("C")} · D 연혁 ${cnt("D")} · (신뢰도 하 ${low.length})`);

  // assert
  let pass = 0;
  for (const t of ASSERTS) {
    const r = rows.find((x) => t.doc.test(x.doc) && t.name.test(x.name));
    const ok = r && r.kind === t.expect;
    if (ok) pass++;
    console.log(`${ok ? "✅" : "❌"} [${t.expect}] ${t.doc.source} ${t.name.source} → ${r ? `${r.kind}/${r.conf}(A${r.scoreA} B${r.scoreB} C${r.scoreC})` : "미발견"}`);
  }
  console.log(`assert ${pass}/${ASSERTS.length}`);

  // 검수시트(HTML) — 신뢰도 하 → 중 → 상, 분류별 그룹
  const stamp = "review";
  const order: Record<string, number> = { 하: 0, 중: 1, 상: 2, 확정: 3 };
  const sorted = [...rows].sort((a, b) => order[a.conf] - order[b.conf] || a.kind.localeCompare(b.kind) || b.len - a.len);
  const KIND_LABEL: Record<string, string> = { A: "A 기준표(명제화)", B: "B 서식표(용도주석)", C: "C 본문표(유지)", D: "D 연혁(유지)" };
  const html = `<!doctype html><meta charset="utf-8"><title>표 성격 분류 검수시트</title>
<style>body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;margin:20px;font-size:13px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:top}
th{background:#f2f4f8;position:sticky;top:0}pre{margin:0;white-space:pre-wrap;font-size:11px;color:#555;max-height:90px;overflow:auto}
.하{background:#fff7ed}.중{background:#fefce8}.k-A{color:#b45309;font-weight:700}.k-B{color:#1d4ed8;font-weight:700}.k-C{color:#6b7280}.k-D{color:#6b7280}</style>
<h2>표 성격 분류 검수시트 (${rows.length}건 · 신뢰도 '하' ${low.length}건 우선 검토)</h2>
<p>A 기준표 ${cnt("A")} · B 서식표 ${cnt("B")} · C 본문표 ${cnt("C")} · D 연혁 ${cnt("D")} — 분류가 틀린 행은 표시해 주시면 규칙에 반영합니다.</p>
<table><tr><th>#</th><th>신뢰</th><th>분류</th><th>문서</th><th>청크</th><th>행/빈셀</th><th>판정근거(A/B/C점수)</th><th>표 미리보기</th></tr>
${sorted.map((r, i) => `<tr class="${r.conf}"><td>${i + 1}</td><td>${r.conf}</td><td class="k-${r.kind}">${KIND_LABEL[r.kind]}</td><td>${esc(r.doc)}</td><td>${esc(r.name)}</td><td>${r.rows}행/${r.emptyPct}%</td><td>${esc(r.signals.join(", "))} (${r.scoreA}/${r.scoreB}/${r.scoreC})</td><td><pre>${esc(r.preview)}</pre></td></tr>`).join("\n")}
</table>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, `table-classify-${stamp}.html`);
  fs.writeFileSync(htmlPath, html);
  const csvPath = path.join(OUT_DIR, `table-classify-${stamp}.csv`);
  fs.writeFileSync(csvPath, "conf,kind,doc,name,rows,emptyPct,scoreA,scoreB,scoreC,signals\n" +
    sorted.map((r) => [r.conf, r.kind, r.doc, r.name, r.rows, r.emptyPct, r.scoreA, r.scoreB, r.scoreC, r.signals.join("|")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"));
  console.log(`검수시트: ${htmlPath} · ${csvPath}`);

  if (APPLY) {
    let updatedDocs = 0, tagged = 0;
    for (const d of docs) {
      const arts = d.articles as ({ name: string; fullText?: string } & Record<string, unknown>)[];
      let touched = false;
      for (const a of arts) {
        const c = classifyTableChunk(a.name, a.fullText ?? "");
        if (c) {
          const ov = overrides.get(`${d.title as string}\u0000${a.name}`); // 사람 확정 우선
          a.tableKind = ov ?? c.kind;
          a.tableConf = ov ? "확정" : c.conf;
          tagged++; touched = true;
        } else if (a.tableKind) { delete a.tableKind; delete a.tableConf; touched = true; }
      }
      if (touched) { await col.updateOne({ _id: d._id }, { $set: { articles: arts } }); updatedDocs++; }
    }
    console.log(`✔ 저장: 문서 ${updatedDocs}개 · 표 청크 태깅 ${tagged}건 (articles[].tableKind/tableConf)`);
  } else {
    console.log("(저장하려면 --apply)");
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
