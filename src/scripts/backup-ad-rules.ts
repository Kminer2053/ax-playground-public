/**
 * 광고도안심의 룰셋 백업 — 라이브 MongoDB(AdIndustryRule + AdReviewCriteria)를
 * 타임스탬프 JSON으로 그대로 덤프한다. 룰셋 수정 전 안전 스냅샷용.
 * 실행: npm run backup:ad-rules
 * 출력: backups/ad-ruleset-YYYYMMDD-HHMM.json
 *
 * 복원: 같은 JSON을 보고 admin UI/seed로 되돌리거나, 별도 restore 스크립트로 upsert.
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local 또는 환경 변수를 설정하세요.");
  process.exit(1);
}
// 앱(lib/db.ts)과 동일하게 dbName을 적용해 실제 서비스 DB를 백업한다.
const MONGODB_DB = (process.env.MONGODB_DB || "").trim() || "axplayground";

import mongoose from "mongoose";
import { AdIndustryRuleModel } from "../models/AdIndustryRule";
import { AdReviewCriteriaModel } from "../models/AdReviewCriteria";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  await mongoose.connect(MONGODB_URI!, { dbName: MONGODB_DB });

  const industryRules = await AdIndustryRuleModel.find({}).sort({ sortOrder: 1 }).lean();
  const criteria = await AdReviewCriteriaModel.find({}).lean();

  const backup = {
    _meta: {
      kind: "ad-review-ruleset-backup",
      exportedAt: new Date().toISOString(),
      db: MONGODB_DB,
      counts: { industryRules: industryRules.length, criteria: criteria.length },
    },
    industryRules,
    criteria,
  };

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ad-ruleset-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf8");

  console.log(`광고심의 룰셋 백업 완료 → ${path.relative(process.cwd(), file)}`);
  console.log(`  업종 룰 ${industryRules.length}건, 심의기준 ${criteria.length}건 (db=${MONGODB_DB})`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("백업 실패:", e);
  process.exit(1);
});
