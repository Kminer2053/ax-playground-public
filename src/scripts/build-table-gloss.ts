/**
 * A 기준표 명제화(tableGloss) 생성·저장 + 해당 청크 재임베딩.
 *   MONGODB_URI=... npx tsx src/scripts/build-table-gloss.ts --dry            # 미리보기(저장 없음)
 *   MONGODB_URI=... npx tsx src/scripts/build-table-gloss.ts                  # 파일럿 3문서 적용
 *   MONGODB_URI=... npx tsx src/scripts/build-table-gloss.ts --all            # A류 보유 전 문서
 *   MONGODB_URI=... npx tsx src/scripts/build-table-gloss.ts --docs "제목1,제목2"
 * 대상: tableKind==="A" 청크만. 원문(fullText)은 불변 — 롤백은 tableGloss $unset + 재임베딩.
 * (재적재 시에는 regulations-ingest가 분류·명제를 자동 재생성한다 — 수동 재실행은 일괄 갱신용)
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { buildTableGloss } from "@/lib/regulations-table-gloss";
import { getEmbedding } from "@/lib/embedding";
import { collectionName } from "@/lib/collections";

const PILOT_DOCS = ["위임전결규정", "상벌운영 세칙", "2026년도 내부 성과평가 편람"];

async function main() {
  const dry = process.argv.includes("--dry");
  const all = process.argv.includes("--all");
  const docsArg = process.argv.indexOf("--docs");

  await connectDb();
  const col = mongoose.connection.db!.collection(collectionName("ragRegulation"));
  const vec = mongoose.connection.db!.collection(collectionName("ragVectors"));

  let targets: string[];
  if (docsArg >= 0) targets = process.argv[docsArg + 1].split(",").map((s) => s.trim());
  else if (all) {
    targets = (await col.find({ "articles.tableKind": "A" }, { projection: { title: 1 } }).toArray()).map((d) => d.title as string);
    console.log(`--all: A 기준표 보유 문서 ${targets.length}개`);
  } else targets = PILOT_DOCS;

  let made = 0, skipped = 0, embedded = 0;
  for (const title of targets) {
    const d = await col.findOne({ title });
    if (!d) { console.log(`✗ 문서 없음: ${title}`); continue; }
    const arts = d.articles as ({ name: string; fullText?: string; tableKind?: string; tableGloss?: string } & Record<string, unknown>)[];
    let touched = false;
    for (let ci = 0; ci < arts.length; ci++) {
      const a = arts[ci];
      if (a.tableKind !== "A") continue;
      const gloss = buildTableGloss(a.name, a.fullText ?? "");
      if (!gloss) { skipped++; if (a.tableGloss) { delete a.tableGloss; touched = true; } continue; }
      made++;
      console.log(`◆ ${title} · ${a.name} — 명제 ${gloss.split("\n").length}행 ${gloss.length}자`);
      if (dry) { console.log(gloss.split("\n").slice(0, 6).map((l) => "   " + l).join("\n") + (gloss.split("\n").length > 6 ? "\n   …" : "")); continue; }
      a.tableGloss = gloss;
      touched = true;
      // 재임베딩: 표 별표는 본문이 파이프 기호 위주라 명제(문장)를 앞세워 의미 밀도를 높인다
      const text = `${a.name}\n${gloss}\n${(a.fullText ?? "").trim()}`;
      const v = await getEmbedding(text);
      if (v) { await vec.updateOne({ doc: title, ci }, { $set: { vec: v } }); embedded++; }
      else console.log(`  (임베딩 실패 — 기존 벡터 유지: ${a.name})`);
    }
    if (!dry && touched) await col.updateOne({ _id: d._id }, { $set: { articles: arts } });
  }
  console.log(`\n${dry ? "[dry] " : ""}명제화 ${made}건 · 생성불가(표 부실) ${skipped}건 · 재임베딩 ${embedded}건`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
