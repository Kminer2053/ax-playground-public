/**
 * 사규 목록·메타데이터 추출 → 엑셀(.xlsx) + CSV.
 * 실행: npm run export:regulations  [출력경로(선택)]
 * 기본 출력: ~/Downloads/사규목록_메타데이터.{xlsx,csv}
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("MONGODB_URI 없음 (.env.local 확인)"); process.exit(1); }
const MONGODB_DB = (process.env.MONGODB_DB || "").trim() || "axplayground";

const CAT_ORDER = ["규정", "세칙", "지침", "편람", "매뉴얼", "계약서"];

async function main() {
  const mongoose = (await import("mongoose")).default;
  const XLSX = await import("xlsx");
  const { RagRegulationModel } = await import("../models/RagRegulation");
  await mongoose.connect(MONGODB_URI!, { dbName: MONGODB_DB });

  const docs = await RagRegulationModel.find({}).lean<Array<Record<string, unknown>>>();
  const rows = docs.map((d) => {
    const arts = (d.articles as Array<{ page?: string }>) || [];
    const pages = new Set(arts.map((a) => a.page).filter((p) => p && p !== "")).size;
    const meta = (d.metadata as Record<string, unknown>) || {};
    const orig = (meta.origMeta as Record<string, string>) || {};
    return {
      분류: String(d.category || ""),
      문서번호: String(d.docNumber || ""),
      제목: String(d.title || ""),
      "개정/시행": String(d.year || ""),
      "조문·청크수": arts.length,
      페이지수: pages,
      청킹방식: String(meta.chunkVia || ""),
      원본파일: String(orig["원본파일"] || meta.sourceFile || ""),
    };
  });
  rows.sort((a, b) => {
    const ci = CAT_ORDER.indexOf(a.분류) - CAT_ORDER.indexOf(b.분류);
    return ci !== 0 ? ci : a.제목.localeCompare(b.제목, "ko");
  });
  const numbered = rows.map((r, i) => ({ 번호: i + 1, ...r }));

  const dest = process.argv[2] || path.join(os.homedir(), "Downloads", "사규목록_메타데이터");
  const ws = XLSX.utils.json_to_sheet(numbered);
  ws["!cols"] = [{ wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 36 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "사규목록");
  XLSX.writeFile(wb, `${dest}.xlsx`);
  fs.writeFileSync(`${dest}.csv`, "﻿" + XLSX.utils.sheet_to_csv(ws), "utf8"); // BOM: Excel 한글

  console.log(`추출 완료: ${numbered.length}건`);
  console.log(`  ${dest}.xlsx`);
  console.log(`  ${dest}.csv`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("추출 실패:", e); process.exit(1); });
