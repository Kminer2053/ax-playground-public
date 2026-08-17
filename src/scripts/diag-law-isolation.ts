/**
 * 외부규범(법령·행정규칙) 검색 격리 실측 — 회수 단계 배터리.
 *  ① 법령 인접 질의 20종: top-8에 법령·행정규칙 유입 0건이어야 함
 *  ② 법령명 명시 질의 4종: 격리 유지 관찰(사규만 노출 — UX 판단자료)
 *  ③ BM25 경로(BM25_SEARCH=1 대비): bm25 인덱스 코퍼스에 법령 미포함 확인
 * 사용: MONGODB_URI=... npx tsx src/scripts/diag-law-isolation.ts
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { bm25SearchTitles } from "@/lib/regulations-bm25";
import mongoose from "mongoose";

const LAW_ADJACENT = [
  "개인정보 파기 절차", "개인정보 유출 시 신고", "연차휴가 이월 기준", "임금 지급일",
  "수의계약으로 할 수 있는 경우", "입찰 보증금 납부", "낙찰자 결정 방법", "계약보증금 면제",
  "중대재해 발생 시 대응", "안전점검 주기", "산업재해 보고", "위험성 평가 절차",
  "청탁 신고 절차", "이해충돌 신고", "공익신고자 보호", "징계 사유",
  "퇴직급여 지급", "하도급 대금 지급", "정보공개 청구 처리", "보안 위반 조치",
];
const LAW_NAMED = ["근로기준법 연차휴가", "국가계약법 수의계약", "개인정보 보호법 파기", "산업안전보건법 안전교육"];

async function main() {
  await connectDb();
  const extSet = new Set(
    (await RagRegulationModel.find({ category: { $in: ["법령", "행정규칙"] } }).select("title").lean()).map((d) => String(d.title))
  );
  console.log(`외부규범 문서 ${extSet.size}건 기준으로 검사\n`);

  let leaks = 0;
  const run = async (label: string, qs: string[]) => {
    console.log(`── ${label} ──`);
    for (const q of qs) {
      const hits = (await retrieveRagRegulationsForQa(q, 8)) as { title?: string }[];
      const leak = hits.filter((h) => extSet.has(String(h.title)));
      if (leak.length) { leaks += leak.length; console.log(`  ✗ "${q}" → 유입: ${leak.map((l) => l.title).join(", ")}`); }
      else console.log(`  ✓ "${q}" → top${hits.length} 전부 사규 (1위: ${hits[0]?.title ?? "-"})`);
    }
  };
  await run("① 법령 인접 질의", LAW_ADJACENT);
  await run("② 법령명 명시 질의(관찰)", LAW_NAMED);

  console.log("\n── ③ BM25 코퍼스 ──");
  const bmLeaks: string[] = [];
  for (const q of ["개인정보", "수의계약", "안전보건", "근로 연차"]) {
    const rows = (await bm25SearchTitles(q, 10).catch(() => [])) as { title?: string }[];
    for (const r of rows) if (extSet.has(String(r.title))) bmLeaks.push(`${q}→${r.title}`);
  }
  console.log(bmLeaks.length ? `  ✗ 유입 ${bmLeaks.length}: ${bmLeaks.join(", ")}` : "  ✓ BM25 상위에 외부규범 0건");
  leaks += bmLeaks.length;

  console.log(`\n총 유입: ${leaks}건 ${leaks === 0 ? "→ 격리 통과" : "→ 격리 실패(수정 필요)"}`);
  await mongoose.disconnect();
  process.exit(leaks === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
