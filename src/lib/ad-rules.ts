import { connectDb } from "@/lib/db";
import { AdIndustryRuleModel } from "@/models/AdIndustryRule";
import { AdReviewCriteriaModel } from "@/models/AdReviewCriteria";

/**
 * 광고도안심의 룰셋·기준 로더 (GuardConfig 패턴: 30초 캐시 + 저장 시 즉시 무효화).
 * /api/ad/review(P8)는 반드시 이 로더로 룰셋·기준을 조회한다(프롬프트 하드코딩 금지).
 */

export type IndustryRule = {
  industry: string;
  category: string;
  highRisk: boolean;
  banned: boolean;
  basis: string;
  riskExpressions: string[];
  requiredNotices: string[];
  attachments: string[];
  note: string;
  rejections: string[];
  sortOrder: number;
};

export type AdCriteria = {
  criteriaText: string;
  prohibitedList: string[];
};

type Lean = Record<string, unknown>;
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;

function toRule(d: Lean): IndustryRule {
  return {
    industry: str(d.industry),
    category: str(d.category),
    highRisk: bool(d.highRisk),
    banned: bool(d.banned),
    basis: str(d.basis),
    riskExpressions: arr(d.riskExpressions),
    requiredNotices: arr(d.requiredNotices),
    attachments: arr(d.attachments),
    note: str(d.note),
    rejections: arr(d.rejections),
    sortOrder: typeof d.sortOrder === "number" ? d.sortOrder : 0,
  };
}

const TTL_MS = 30_000;
let _rulesCache: { rules: IndustryRule[]; at: number } | null = null;
let _criteriaCache: { criteria: AdCriteria; at: number } | null = null;

/** 업종별 룰셋 (sortOrder 정렬). DB 비었으면 빈 배열(시드 필요). */
export async function getIndustryRules(): Promise<IndustryRule[]> {
  const now = Date.now();
  if (_rulesCache && now - _rulesCache.at < TTL_MS) return _rulesCache.rules;
  try {
    await connectDb();
    const docs = await AdIndustryRuleModel.find({}).sort({ sortOrder: 1 }).lean<Lean[]>().exec();
    const rules = docs.map(toRule);
    _rulesCache = { rules, at: now };
    return rules;
  } catch {
    return _rulesCache?.rules ?? [];
  }
}

/** 특정 업종 룰 1건 (없으면 null — 호출측에서 공통 처리). */
export async function getIndustryRule(industry: string): Promise<IndustryRule | null> {
  const rules = await getIndustryRules();
  return rules.find((r) => r.industry === industry) ?? null;
}

/** 공통 심의기준 + 금지광고 목록 (싱글톤). */
export async function getAdCriteria(): Promise<AdCriteria> {
  const now = Date.now();
  if (_criteriaCache && now - _criteriaCache.at < TTL_MS) return _criteriaCache.criteria;
  try {
    await connectDb();
    const doc = await AdReviewCriteriaModel.findOne({ key: "default" }).lean<Lean | null>().exec();
    const criteria: AdCriteria = {
      criteriaText: str(doc?.criteriaText),
      prohibitedList: arr(doc?.prohibitedList),
    };
    _criteriaCache = { criteria, at: now };
    return criteria;
  } catch {
    return _criteriaCache?.criteria ?? { criteriaText: "", prohibitedList: [] };
  }
}

/** 관리 API에서 룰셋·기준 저장 후 호출 — 캐시 즉시 무효화. */
export function invalidateAdRulesCache(): void {
  _rulesCache = null;
  _criteriaCache = null;
}
