/**
 * 온톨로지 조직축 시드 — 직제 규정 제6조를 결정적 파싱해 Dept 트리 + 부서상하 엣지 생성.
 * LLM 무관·규칙 기반(provenance.method=rule, status=validated). 관리자 승격은 별도(M3/ontology-promote).
 *
 * 실행(dotenv 임포트 순서 잠복 이슈로 MONGODB_URI 직접 주입):
 *   MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npx tsx src/scripts/seed-ontology-org.ts [--dry]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { putNode, putEdge, type Provenance } from "@/lib/ontology-store";
import { manifestSummary, makeSlug } from "@/lib/ontology-manifest";

const DRY = process.argv.includes("--dry");
const AT = new Date().toISOString();
const PROV: Provenance = { method: "rule", at: AT };
const SRC_DOC = "직제 규정";
const SRC_ART = "제6조";

type ParsedDept = { label: string; parent: string | null; order: number };

/** 제6조 fullText → 본사 조직 트리(본부/실/센터 + 처). */
function parseOrgTree(fullText: string): { arts: string; depts: ParsedDept[] } {
  const artName = "제6조";
  const lines = fullText.split(/\n/).map((l) => l.replace(/<[^>]*>/g, "").trim()); // 개정 마커 제거
  const depts: ParsedDept[] = [];
  let order = 0;
  for (const ln of lines) {
    const m = ln.match(/^\d+\.\s*(.+)$/);
    if (!m) continue;
    const body = m[1].trim();
    // "본부명 : 처1, 처2" 또는 단독 "감사실"
    const colon = body.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (colon) {
      const head = colon[1].trim();
      depts.push({ label: head, parent: null, order: ++order }); // 본부(최상위)
      for (const child of colon[2].split(/[,，、]/).map((s) => s.trim()).filter(Boolean)) {
        depts.push({ label: child, parent: head, order: ++order }); // 처(하위)
      }
    } else {
      depts.push({ label: body, parent: null, order: ++order }); // 실·센터(단독 최상위)
    }
  }
  return { arts: artName, depts };
}

/** deptPath = 최상위/…/본인 (본부명 → 본부명/처명). */
function deptPath(d: ParsedDept, byLabel: Map<string, ParsedDept>): string {
  const chain: string[] = [];
  let cur: ParsedDept | undefined = d;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.label)) {
    seen.add(cur.label);
    chain.unshift(cur.label);
    cur = cur.parent ? byLabel.get(cur.parent) : undefined;
  }
  return chain.join("/");
}

async function main() {
  console.log(`[온톨로지 시드] 조직축 — 매니페스트 ${JSON.stringify(manifestSummary().version)}${DRY ? " (dry)" : ""}`);
  await connectDb();

  const doc = await RagRegulationModel.findOne({ title: SRC_DOC }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>();
  if (!doc) throw new Error(`시드 소스 미존재: ${SRC_DOC}`);
  const art = doc.articles.find((a) => a.name.startsWith(SRC_ART));
  if (!art?.fullText) throw new Error(`${SRC_DOC} ${SRC_ART} 조문 없음`);

  const { depts } = parseOrgTree(art.fullText);
  const byLabel = new Map(depts.map((d) => [d.label, d]));
  const quote = "① 본사에는 다음 각 호와 같이 실ㆍ본부와 그 하부조직을 둔다.";

  let nodeN = 0;
  let edgeN = 0;
  for (const d of depts) {
    const path = deptPath(d, byLabel);
    console.log(`  Dept ${d.order}: ${path}`);
    if (!DRY) {
      await putNode({
        space: "org",
        type: "Dept",
        label: d.label,
        props: { deptPath: path, kind: "본사", order: d.order },
        status: "validated",
        provenance: PROV,
      });
    }
    nodeN++;
  }
  // 부서상하 엣지(하위 처 → 직상위 본부) — evidence는 제6조(추적성). id는 makeSlug 단일 규칙.
  for (const d of depts) {
    if (!d.parent) continue;
    const from = makeSlug("dept", d.label);
    const to = makeSlug("dept", d.parent);
    console.log(`  부서상하: ${d.label} → ${d.parent}`);
    if (!DRY) {
      await putEdge({
        rel: "부서상하",
        from,
        to,
        fromSpace: "org",
        fromType: "Dept",
        toSpace: "org",
        toType: "Dept",
        status: "validated",
        rtConf: "상",
        evidence: { doc: SRC_DOC, name: art.name, quote },
        provenance: PROV,
      });
    }
    edgeN++;
  }

  console.log(`\n[대사] Dept 노드 ${nodeN} · 부서상하 엣지 ${edgeN}${DRY ? " (dry — 미저장)" : " 저장"}`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
