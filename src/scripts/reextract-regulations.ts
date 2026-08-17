/**
 * 정제텍스트가 뒤섞이거나 누락된 사규를 원문 HWP에서 재추출해 교체.
 * /tmp/reextract-map.json [{title,cat,year,src,hwp,hwpName}] 기준.
 * kordoc CLI 추출 → normalizeExtracted(표 파이프·헤더 정리) → data/regulations-2026 교체(.md).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeExtracted } from "../lib/regulations-ingest";

const KORDOC = path.join(process.cwd(), "node_modules", "kordoc", "dist", "cli.js");
const map = JSON.parse(fs.readFileSync("/tmp/reextract-map.json", "utf8")) as Array<{
  title: string; cat: string; year: string; src: string; hwp: string; hwpName: string;
}>;

for (const m of map) {
  let raw = "";
  try {
    raw = execFileSync(process.execPath, [KORDOC, m.hwp, "--format", "markdown", "--silent"], { maxBuffer: 128 * 1024 * 1024, encoding: "utf8" });
  } catch (e) {
    console.log("FAIL 추출:", m.title, "—", (e instanceof Error ? e.message : String(e)).slice(0, 80));
    continue;
  }
  const md = normalizeExtracted(raw);
  const jo = (md.match(/제\s*\d+\s*조/g) || []).length;
  if (md.replace(/\s/g, "").length < 200) { console.log("WARN 빈추출:", m.title); continue; }

  const out = m.src.replace(/\.(txt|md)$/, ".md");
  const fm = [
    "---",
    `규정명: ${m.title}`,
    `규정종류: ${m.cat}`,
    m.year ? `최종시행일: ${m.year}` : "",
    `원본파일: ${m.hwpName}`,
    "비고: 원문 HWP 재추출(정제텍스트 순서·누락 정정)",
    "---",
    "",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(out, fm + md + "\n", "utf8");
  if (m.src !== out && fs.existsSync(m.src)) fs.unlinkSync(m.src); // 구 .txt 제거
  console.log(`OK: ${path.basename(out)} (${md.length}자, 제N조 ${jo}개)`);
}
console.log("재추출 완료");
