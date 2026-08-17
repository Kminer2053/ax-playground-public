/**
 * 사규 재적재 CLI — 관리자 UI(사규 적재 탭)의 commit 경로를 그대로 실행.
 * 개정본 HWP/PDF/HWPX → 추출(스캔 PDF는 OCR) → 조문 청킹·자가검수 → 동일 제목 교체 →
 * sagyu.json 재생성 → 임베딩·지식그래프 증분 갱신(srcHash 재사용: 무변경 조문은 재계산 skip) →
 * 표 태깅·명제화 → 근거 영향 격리 → 상태 집계(finalizeDocChange) → 예상질문 스모크.
 *
 * 사용:
 *   MONGODB_URI="mongodb://127.0.0.1:27017/axplayground" \
 *   OPENAI_COMPATIBLE_BASE_URL="http://127.0.0.1:8080/v1" OPENAI_COMPATIBLE_MODEL="mlx-community/gemma-4-e2b-it-4bit" OPENAI_COMPATIBLE_API_KEY="x" \
 *   npm run reg:ingest -- --file "/path/계약업무 처리지침.hwp" [--category 지침] [--title 제목재정] [--year 2026-06-25] [--docNumber 제16호] [--smoke "질문1
질문2"] [--dry]
 *
 *  - 임베딩(bge-m3)·그래프 검증(gemma)은 DB 설정(관리자>설정)을 따르므로 해당 서버 가동 필요.
 *    임베딩 서버 미가동 시 벡터·그래프 갱신은 건너뛰고 본문 적재만 수행된다(관리자 UI와 동일).
 *  - 청킹 노브(청킹: 편람가나다 등)는 원문 프런트매터에 없으면 기존본 origMeta에서 승계(관리자 UI와 동일).
 *  - 스모크 질문은 --smoke(줄 단위)가 없으면 기존본 metadata.smokeQuestions를 승계해 실행.
 *  - --dry: 추출·청킹·검수·변경분류(diff)까지만 하고 DB는 건드리지 않음.
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { extractRegulationFile } from "@/lib/regulations-extract";
import { ingestText, chunkKnobsOf } from "@/lib/regulations-ingest";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";
import { updateGraphForDoc } from "@/lib/regulations-graph-build";
import { finalizeDocChange } from "@/lib/doc-change";
import { runSmokeQuestions, parseSmokeQuestions } from "@/lib/regulations-smoke";
import { collectionName } from "@/lib/collections";

// ── 변경 4분류(관리자 UI의 diff와 동일 기준: 낱말집합 — 표 표기차에 견고) ──
const normText = (s?: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const stripMarkers = (s: string) => s.replace(/<\s*(개정|신설|삭제|전문개정|본조신설|제목개정|폐지)[^>]*>/g, " ");
const stripRename = (s: string) => s.replace(/기획재정부/g, "재정경제부");
const wordBag = (s: string) => [...new Set(s.match(/[가-힣]+|[A-Za-z0-9]+/g) || [])].sort().join(" ");
function classify(o: string, n: string): "cosmetic" | "marker" | "rename" | "real" {
  if (wordBag(o) === wordBag(n)) return "cosmetic";
  if (wordBag(stripMarkers(o)) === wordBag(stripMarkers(n))) return "marker";
  if (wordBag(stripMarkers(stripRename(o))) === wordBag(stripMarkers(stripRename(n)))) return "rename";
  return "real";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type PrevLean = {
  year?: string; docNumber?: string;
  articles?: { name: string; fullText?: string }[];
  metadata?: { origMeta?: Record<string, string>; auditHistory?: unknown[]; smokeQuestions?: string[] };
};

async function main() {
  const file = arg("file");
  if (!file) { console.error('사용: npm run reg:ingest -- --file "<hwp/pdf 경로>" [--category 지침] [--dry]'); process.exit(1); }
  const dry = process.argv.includes("--dry");
  const category = arg("category") || "지침";

  console.log(`[1/5] 추출: ${file}`);
  const ex = await extractRegulationFile(file, path.basename(file));
  console.log(`      방법=${ex.method} · ${ex.chars.toLocaleString()}자 · 한글 ${(ex.koreanRatio * 100).toFixed(0)}%${ex.note ? ` · ${ex.note}` : ""}`);

  await connectDb();

  console.log(`[2/5] 청킹·검수`);
  const baseOpts = {
    sourceName: path.basename(file), category,
    titleOverride: arg("title"), yearOverride: arg("year"), docNumberOverride: arg("docNumber"),
    // 관리자 라우트와 동일: md·txt는 정제본(정규화 없이), 그 외(hwp·pdf)만 추출본 정규화
    isExtracted: ![".txt", ".md", ".markdown"].includes(path.extname(file).toLowerCase()),
  };
  let { doc, audit } = ingestText(ex.text, baseOpts);
  // 청킹 노브 승계(관리자 라우트와 동일) — 원문에 노브가 없고 기존본에 있으면 기존 노브로 재청킹.
  // 이게 없으면 편람류를 CLI로 재적재할 때 세밀 청킹이 통짜로 뭉개진다(34↔119청크 실측).
  let chunkKnobsInherited: Record<string, string> | undefined;
  if (doc.title && !Object.keys(chunkKnobsOf((doc.metadata?.origMeta ?? {}) as Record<string, string>)).length) {
    const prevDoc = await RagRegulationModel.findOne({ title: doc.title })
      .select("metadata.origMeta").lean<{ metadata?: { origMeta?: Record<string, string> } }>();
    const prevKnobs = chunkKnobsOf(prevDoc?.metadata?.origMeta ?? {});
    if (Object.keys(prevKnobs).length) {
      ({ doc, audit } = ingestText(ex.text, { ...baseOpts, metaDefaults: prevKnobs }));
      chunkKnobsInherited = prevKnobs;
    }
  }
  console.log(`      제목="${doc.title}" · 시행일=${doc.year || "(공란→기존 승계)"} · 연번=${doc.docNumber || "(공란→기존 승계)"} · 조문 ${doc.articles.length}개 · 검수=${audit.score}(보존율 ${audit.retentionPct}%)${chunkKnobsInherited ? ` · 노브 승계 ${Object.entries(chunkKnobsInherited).map(([k, v]) => `${k}:${v}`).join(",")}` : ""}`);
  if (!doc.title) { console.error("제목이 비어 있습니다(--title 지정)."); process.exit(1); }
  if (!doc.articles.length || audit.score === "bad") { console.error("품질 미달 — 적재 중단.", audit.flags); process.exit(1); }

  const prev = await RagRegulationModel.findOne({ title: doc.title })
    .select("year docNumber articles.name articles.fullText metadata.auditHistory metadata.smokeQuestions").lean<PrevLean>();

  // 변경 분류(기존본 있을 때)
  if (prev?.articles?.length) {
    const oldMap = new Map(prev.articles.map((a) => [a.name, a.fullText ?? ""]));
    const newSet = new Set(doc.articles.map((a) => a.name));
    const added = doc.articles.filter((a) => !oldMap.has(a.name)).length;
    const removed = prev.articles.filter((a) => !newSet.has(a.name)).length;
    const cats = { real: 0, rename: 0, marker: 0, cosmetic: 0 };
    const realNames: string[] = [];
    for (const a of doc.articles) {
      const o = oldMap.get(a.name);
      if (o == null || normText(o) === normText(a.fullText)) continue;
      const c = classify(o, a.fullText);
      cats[c]++;
      if (c === "real") realNames.push(a.name);
    }
    console.log(`[3/5] 변경점(vs 기존 시행일 ${prev.year || "—"}): 추가 +${added} · 삭제 −${removed} · 실질변경 ${cats.real} · 비실질 ${cats.rename + cats.marker + cats.cosmetic}(명칭 ${cats.rename}·마커 ${cats.marker}·표기차 ${cats.cosmetic})`);
    if (realNames.length) console.log(`      실질변경 조문: ${realNames.slice(0, 12).join(", ")}${realNames.length > 12 ? " …" : ""}`);
  } else {
    console.log(`[3/5] 기존본 없음 → 신규 적재`);
  }

  if (dry) { console.log("[dry] DB 미변경 종료"); await mongoose.disconnect(); return; }

  const effYear = doc.year || prev?.year || "";
  const effDocNumber = doc.docNumber || prev?.docNumber || "";
  const effSmoke = parseSmokeQuestions(arg("smoke") || "").length ? parseSmokeQuestions(arg("smoke") || "") : (prev?.metadata?.smokeQuestions ?? []);
  let directParent: string | undefined;
  try {
    const h = await mongoose.connection.db?.collection(collectionName("ragGraphEdges")).findOne({ kind: "hier", sdoc: doc.title }, { projection: { tdoc: 1 } });
    directParent = (h as { tdoc?: string } | null)?.tdoc || undefined;
  } catch { /* 위계 미적재 */ }

  console.log(`[4/5] 교체 적재(시행일=${effYear || "—"} · 연번=${effDocNumber || "—"} · 위계부모=${directParent || "—"})`);
  // 관리자 라우트와 동일한 교체 순서: 새 문서 save 먼저, 삭제는 "나보다 먼저 만들어진 버전"만.
  // CLI는 서버와 다른 프로세스라 라우트의 프로세스 내 제목 락이 미치지 않는다 — 관리자 커밋과
  // 동시에 돌아도 최후 생성본이 항상 살아남게 createdAt 가드로 방어한다(0건 유실 방지).
  const auditRec = { at: new Date().toISOString(), score: audit.score, retentionPct: audit.retentionPct, retentionCorePct: audit.retentionCorePct, chunks: audit.chunks, flags: audit.flags };
  const auditHistory = [...(prev?.metadata?.auditHistory ?? []).slice(-4), auditRec];
  const created = new RagRegulationModel({
    title: doc.title, year: effYear, category: doc.category, docNumber: effDocNumber,
    content: doc.title,
    articles: doc.articles.map((a) => ({ name: a.name, fullText: a.fullText, order: a.order, page: a.page })),
    metadata: { ...doc.metadata, ingestedVia: "cli", ...(chunkKnobsInherited ? { chunkKnobsInherited } : {}), audit: auditRec, auditHistory, smokeQuestions: effSmoke },
  });
  await created.save();
  const createdAt = (created.get("createdAt") as Date | undefined) ?? new Date();
  const del = await RagRegulationModel.deleteMany({
    title: doc.title, _id: { $ne: created._id },
    $or: [{ createdAt: { $lt: createdAt } }, { createdAt: { $exists: false } }],
  });
  let sagyu = -1;
  try { sagyu = await buildSagyuFromDb(); }
  catch (e) { console.warn(`      ⚠ sagyu.json 재생성 실패(적재 자체는 완료): ${e instanceof Error ? e.message : e}`); }
  console.log(`      기존 ${del.deletedCount || 0}건 대체 · 전체 사규 ${sagyu >= 0 ? sagyu : "?"}건(sagyu.json 재생성)`);

  if (/^(법령|행정규칙)$/.test(doc.category)) {
    // 외부규범: 검색 격리 대상(ONTOLOGY.md §5) — 벡터·그래프·표태깅 생략(조문 직행·근거보기 전용)
    console.log(`[5/5] 외부규범(${doc.category}) — 임베딩·그래프·표태깅 생략`);
    await reportFinalize(doc.title, { retag: false });
    await mongoose.disconnect();
    console.log("완료.");
    return;
  }
  console.log(`[5/5] 임베딩·그래프 증분 갱신(무변경 조문은 srcHash 재사용)`);
  try {
    const g = await updateGraphForDoc(doc.title, directParent);
    console.log(`      벡터 ${g.vectors}개(재사용 ${g.reused}) · 그래프 참조 ${g.refEdges}·법령 ${g.lawEdges}(엣지 재사용 ${g.edgeReused})${g.llmFallback ? ` · ⚠ LLM 폴백 ${g.llmFallback}건(다음 적재 때 자동 재판정)` : ""}${g.embedFailed ? ` · ⚠ 임베딩 실패 ${g.embedFailed}건` : ""}`);
  } catch (e) {
    console.warn(`      ⚠ 임베딩/그래프 갱신 실패(적재 자체는 완료): ${e instanceof Error ? e.message : e}`);
  }
  await reportFinalize(doc.title);
  if (effSmoke.length) {
    // 예상 질문 스모크 — 적재가 검색을 깨뜨렸는지 그 자리에서 확인(회수만, LLM 무관).
    const smoke = await runSmokeQuestions(doc.title, effSmoke);
    for (const s of smoke) console.log(`      스모크 ${s.hit ? "✓" : "✗ 미회수"} [${s.hit ? `rank${s.rank}` : "-"}] ${s.q}`);
  }
  await mongoose.disconnect();
  console.log("완료.");
}

/** 적재 후 후처리 일원화 — 관리자·수동 CRUD와 같은 finalizeDocChange(표 태깅→근거 격리→상태 집계). */
async function reportFinalize(title: string, opts?: { retag?: boolean }) {
  const fin = await finalizeDocChange(title, opts);
  if (fin.tableRetag) console.log(`      표 태깅 ${fin.tableRetag.tagged}건 · 명제화 ${fin.tableRetag.glossed}건 · gloss 재임베딩 ${fin.tableRetag.embedded}건`);
  if (fin.impactSummary) console.log(`      ${fin.impactSummary}`);
  const a = fin.assets;
  if (a) {
    console.log(`      상태: 조문 ${a.articles.count}(해시 ${a.articles.hashed}) · 임베딩 ${a.embedding.covered}/${a.embedding.total} · 참조 ${a.graph.refOut}·법령 ${a.graph.law} · 표 ${a.tables.count} · 업무근거 ${a.ontology.edges}`);
    if (a.issues.length) console.log(`      ⚠ 조치 필요 — ${a.issues.join(" / ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
