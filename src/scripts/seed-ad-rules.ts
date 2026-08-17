/**
 * 광고도안심의 룰셋·심의기준 시드 (멱등 upsert).
 * 실행: npm run seed:ad-rules
 * 원천 데이터: src/scripts/ad-rules-data.ts (원본 광고심의 앱에서 이관)
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local 또는 환경 변수를 설정하세요.");
  process.exit(1);
}

import mongoose from "mongoose";
import { AdIndustryRuleModel } from "../models/AdIndustryRule";
import { AdReviewCriteriaModel } from "../models/AdReviewCriteria";
import {
  INDUSTRY_ORDER, RULESETS, COMMON_RULE, PROHIBITED_LIST, CRITERIA_TEXT,
} from "./ad-rules-data";

async function main() {
  await mongoose.connect(MONGODB_URI!);

  // 업종별 룰: INDUSTRY_ORDER 14개 전부 행 생성. RULESETS 정의분은 상세, 미정의분은 공통룰 상속.
  const ruleByIndustry = new Map(RULESETS.map((r) => [r.industry, r]));
  let n = 0;
  for (let i = 0; i < INDUSTRY_ORDER.length; i++) {
    const industry = INDUSTRY_ORDER[i];
    const defined = ruleByIndustry.get(industry);
    const data = defined
      ? { ...defined, sortOrder: i }
      : { industry, ...COMMON_RULE, sortOrder: i };
    await AdIndustryRuleModel.updateOne(
      { industry },
      { $set: data },
      { upsert: true },
    );
    n++;
  }

  // 공통 심의기준 + 금지광고 목록 (싱글톤)
  await AdReviewCriteriaModel.updateOne(
    { key: "default" },
    { $set: { key: "default", criteriaText: CRITERIA_TEXT, prohibitedList: PROHIBITED_LIST } },
    { upsert: true },
  );

  const total = await AdIndustryRuleModel.estimatedDocumentCount();
  console.log(`광고심의 룰셋 시드 완료: 업종 ${n}건 upsert (총 ${total}건), 심의기준 1건.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("시드 실패:", e);
  process.exit(1);
});
