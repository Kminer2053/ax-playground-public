/**
 * 관리자 사규 적재 — 원본(hwp·pdf·docx) 또는 정제본(md·txt) → 최적 청킹 → DB 적재.
 *  mode=preview : 추출(스캔 PDF는 OCR 자동) → 청킹 → 자가검수 결과 반환(+rawText: commit 재사용)
 *  mode=commit  : 동일 제목 교체(upsert) → public/sagyu.json 재생성(좌측 검색 즉시 반영)
 * 품질 게이트: audit.score(good/warn/bad). bad(조문0·빈조문·부칙누수·보존율<55)면 commit 거부.
 */
import { NextResponse } from "next/server";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { extractRegulationFile, SUPPORTED_ATTACHMENT_EXTS } from "@/lib/regulations-extract";
import { ingestText, chunkKnobsOf, type BuildOpts } from "@/lib/regulations-ingest";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";
import { updateGraphForDoc } from "@/lib/regulations-graph-build";
import { finalizeDocChange } from "@/lib/doc-change";
import { checkEmbeddingHealth } from "@/lib/embedding";
import { runSmokeQuestions, parseSmokeQuestions } from "@/lib/regulations-smoke";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { collectionName } from "@/lib/collections";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 대용량 스캔 PDF OCR 여유

const CATEGORIES = ["규정", "세칙", "지침", "편람", "매뉴얼", "계약서"];
const TEXT_EXTS = [".txt", ".md", ".markdown"];

// 청킹 노브 화이트리스트는 regulations-ingest.ts의 chunkKnobsOf 공용 — CLI(reg:ingest)와 목록이 갈라지면 안 된다.

// 제목별 커밋 직렬화 — 같은 제목을 두 관리자가 동시에 커밋하면 save→deleteMany($ne)가
// 교차해 서로의 새 버전을 지울 수 있다. 폐쇄망 단일 서버 전제라 프로세스 내 락으로 충분.
const titleLocks = new Map<string, Promise<unknown>>();
async function withTitleLock<T>(title: string, fn: () => Promise<T>): Promise<T> {
  const prev = titleLocks.get(title) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const guard = run.catch(() => {});   // 대기열용 — 실패해도 다음 대기자는 진행
  titleLocks.set(title, guard);
  try { return await run; }
  finally { if (titleLocks.get(title) === guard) titleLocks.delete(title); }
}

type ExLean = { year?: string; docNumber?: string; category?: string; updatedAt?: Date; articles?: { name: string; fullText?: string }[]; metadata?: { articleCount?: number } };

type Art = { name: string; fullText?: string };
type ChangeCat = "real" | "rename" | "marker" | "cosmetic";
const normText = (s?: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const stripMarkers = (s: string) => s.replace(/<\s*(개정|신설|삭제|전문개정|본조신설|제목개정|폐지)[^>]*>/g, " ");
const stripRename = (s: string) => s.replace(/기획재정부/g, "재정경제부"); // 정부조직법 개정 전역 명칭변경
/** 낱말집합(순서·중복·위치·공백·기호 무관) — 표 병합셀 재배열 등 파서 표기차엔 불변, 실제 낱말 증감만 감지. */
const wordBag = (s: string) => [...new Set(s.match(/[가-힣]+|[A-Za-z0-9]+/g) || [])].sort().join(" ");
/** 변경 성격 분류(경함→중함): 표기차 < 마커만 < 명칭변경 < 실질변경. 인라인 diff가 실측이고 이는 힌트. */
function classifyChange(o: string, n: string): ChangeCat {
  if (wordBag(o) === wordBag(n)) return "cosmetic";                                                       // 표·공백·기호만(파서 표기차)
  if (wordBag(stripMarkers(o)) === wordBag(stripMarkers(n))) return "marker";                             // <개정/신설 날짜>만
  if (wordBag(stripMarkers(stripRename(o))) === wordBag(stripMarkers(stripRename(n)))) return "rename";   // 기획재정부→재정경제부(±마커)
  return "real";                                                                                          // 실제 낱말 증감
}

/** 신·구 조문 비교 → 추가·삭제·변경(성격 4분류)·무변경. changed엔 인라인 diff용 구본문(old) 동봉. */
function diffArticles(oldArts: Art[], newArts: Art[]) {
  const oldMap = new Map(oldArts.map((a) => [a.name, a.fullText ?? ""]));
  const newNames = newArts.map((a) => a.name);
  const newSet = new Set(newNames);
  const added = newNames.filter((x) => !oldMap.has(x));
  const removed = oldArts.map((a) => a.name).filter((x) => !newSet.has(x));
  const changed = newArts
    .filter((a) => oldMap.has(a.name) && normText(oldMap.get(a.name)) !== normText(a.fullText))
    .map((a) => ({ name: a.name, cat: classifyChange(oldMap.get(a.name) || "", a.fullText || ""), old: oldMap.get(a.name) || "" }));
  const cats = { real: 0, rename: 0, marker: 0, cosmetic: 0 };
  for (const c of changed) cats[c.cat]++;
  const kept = newNames.filter((x) => oldMap.has(x)).length; // 이름 유지(=변경 + 무변경)
  return {
    added, removed, changed,          // changed: {name,cat,old}[] — old는 조문 열람 시 인라인 diff 렌더용
    addedCount: added.length, removedCount: removed.length, changedCount: changed.length,
    cats, substantive: cats.real,     // 실질변경 건수(헤드라인)
    kept, unchanged: kept - changed.length,
  };
}

/** 동일 제목 기존본 요약(없으면 null). 제목은 정제 제목(연번·시행일 제외). */
async function findExisting(title: string, newArts?: Art[]) {
  if (!title) return null;
  await connectDb();
  const ex = await RagRegulationModel.findOne({ title }).select("year docNumber category updatedAt articles.name articles.fullText metadata.articleCount").lean<ExLean>();
  if (!ex) return null;
  const oldArts = ex.articles ?? [];
  return {
    year: ex.year ?? "", docNumber: ex.docNumber ?? "", category: ex.category ?? "",
    articleCount: ex.metadata?.articleCount ?? oldArts.length,
    updatedAt: ex.updatedAt ?? null,
    diff: newArts ? diffArticles(oldArts, newArts) : undefined,
  };
}

/** GET ?title= : 동일 제목 기존본 존재/요약(제목 편집 시 교체여부 즉시 확인용). */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const title = (new URL(req.url).searchParams.get("title") ?? "").trim();
  const existing = await findExisting(title);
  return NextResponse.json({ ok: true, exists: !!existing, existing });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 }); }

  const mode = String(form.get("mode") || "preview");
  const category = String(form.get("category") || "").trim();
  const titleOverride = String(form.get("title") || "").trim() || undefined;
  const yearOverride = String(form.get("year") || "").trim() || undefined;
  const docNumberOverride = String(form.get("docNumber") || "").trim() || undefined;
  const smokeQuestions = parseSmokeQuestions(String(form.get("smokeQuestions") || ""));
  if (category && !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `분류는 ${CATEGORIES.join("·")} 중 하나여야 합니다.` }, { status: 400 });
  }

  // 텍스트 확보: commit은 preview의 rawText 재사용(재추출/재OCR 회피), preview는 파일 추출
  let rawText = String(form.get("rawText") || "");
  let sourceName = String(form.get("sourceName") || "");
  let ext = String(form.get("ext") || "").toLowerCase();
  let method = "text";
  let note: string | undefined;
  let chars = 0;
  let koreanRatio = 0;

  if (!rawText) {
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "파일을 첨부하세요." }, { status: 400 });
    sourceName = file.name;
    ext = path.extname(sourceName).toLowerCase();
    if (!SUPPORTED_ATTACHMENT_EXTS.includes(ext)) {
      return NextResponse.json({ error: `지원 형식: ${SUPPORTED_ATTACHMENT_EXTS.join(" ")}` }, { status: 400 });
    }
    const dir = await mkdtemp(path.join(tmpdir(), "reg-ingest-"));
    try {
      const fp = path.join(dir, `src${ext}`);
      await writeFile(fp, Buffer.from(await file.arrayBuffer()));
      const ex = await extractRegulationFile(fp, sourceName); // 전체 추출(스캔→OCR), commit에서 재사용
      rawText = ex.text; method = ex.method; note = ex.note; chars = ex.chars; koreanRatio = ex.koreanRatio;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    if (!rawText.trim()) {
      return NextResponse.json({ error: note || "텍스트를 추출하지 못했습니다(암호화/손상 PDF 가능).", method }, { status: 422 });
    }
  }

  const isExtracted = !TEXT_EXTS.includes(ext);
  const opts: BuildOpts = {
    sourceName: sourceName || "업로드", category: category || "규정",
    titleOverride, yearOverride, docNumberOverride, isExtracted,
  };
  let { doc, audit } = ingestText(rawText, opts);

  // 청킹 노브 승계 — 편람·매뉴얼의 세밀 청킹(청킹: 편람가나다 등)은 정제본 프런트매터에 산다.
  // 부서가 hwp 원본(프런트매터 없음)으로 교체하면 기본 청킹으로 뭉개지므로, 새 원문에 노브가
  // 없고 기존본에 있으면 기존 노브로 다시 청킹한다(새 원문에 노브가 있으면 새것이 이긴다).
  let chunkKnobsInherited: Record<string, string> | null = null;
  {
    await connectDb();
    const curKnobs = chunkKnobsOf((doc.metadata?.origMeta ?? {}) as Record<string, string>);
    if (Object.keys(curKnobs).length === 0 && doc.title) {
      const prevDoc = await RagRegulationModel.findOne({ title: doc.title })
        .select("metadata.origMeta").lean<{ metadata?: { origMeta?: Record<string, string> } }>();
      const prevKnobs = chunkKnobsOf(prevDoc?.metadata?.origMeta ?? {});
      if (Object.keys(prevKnobs).length > 0) {
        ({ doc, audit } = ingestText(rawText, { ...opts, metaDefaults: prevKnobs }));
        chunkKnobsInherited = prevKnobs;
      }
    }
  }

  if (mode !== "commit") {
    const existing = await findExisting(doc.title, doc.articles);
    // 제목 표기 드리프트 감지 — 완전일치 기존본이 없을 때, 공백·기호만 다른 제목이 있으면 알려
    // 신규 적재로 갈라져 폐지본이 잔존하는 사고를 preview에서 막는다.
    let similarTitle: { title: string; articleCount: number } | null = null;
    if (!existing && doc.title) {
      const norm = (s: string) => s.replace(/[\s·ㆍ()（）[\]〔〕-]/g, "");
      const all = await RagRegulationModel.find({}, { title: 1, "metadata.articleCount": 1 }).lean<{ title?: string; metadata?: { articleCount?: number } }[]>();
      const hit = all.find((d) => d.title && d.title !== doc.title && norm(d.title) === norm(doc.title));
      if (hit) similarTitle = { title: String(hit.title), articleCount: hit.metadata?.articleCount ?? 0 };
    }
    return NextResponse.json({
      ok: true, mode: "preview",
      meta: { title: doc.title, category: doc.category, year: doc.year, docNumber: doc.docNumber, pages: doc.pages, via: doc.via },
      method, note, chars, koreanRatio, audit,
      existing, // 동일 제목 기존본(있으면 버전 교체) + 변경점
      similarTitle, chunkKnobsInherited,
      chunks: doc.articles.map((a) => ({ name: a.name, len: a.fullText.length, preview: a.fullText })),
      rawText, ext, sourceName,
    });
  }

  // ── commit ──
  if (!doc.title) return NextResponse.json({ error: "제목이 비어 있습니다." }, { status: 400 });
  if (!doc.articles.length || audit.score === "bad") {
    return NextResponse.json({ error: "품질 미달(조문 0/빈 조문/부칙 누수/보존율 낮음)로 적재할 수 없습니다.", audit }, { status: 422 });
  }
  await connectDb();
  // 임베딩 서버 사전 점검 — 적재는 옛 벡터를 지우고 다시 만드는 작업이라, 서버가 죽어 있으면
  // 벡터만 사라진다(실측: Ollama 미기동 상태로 편람을 적재해 청크 55개가 벡터를 잃었다).
  // 문서를 건드리기 전에 막는다.
  const embedCfg = await getPlaygroundConfig();
  if (embedCfg.ragVectorEnabled) {
    const health = await checkEmbeddingHealth({ model: embedCfg.embedModel, dims: embedCfg.embedDims, baseUrl: embedCfg.embedBaseUrl });
    if (!health.ok) {
      return NextResponse.json({ error: `임베딩 서버 점검 실패로 적재를 중단했습니다. ${health.reason}`, embedDown: true }, { status: 503 });
    }
  }
  // 미리보기 고정 — 커밋 직전 제목·분류 편집으로 재청킹 결과가 달라지면(노브 승계가 붙거나
  // 떨어지거나) 관리자가 화면에서 검수한 것과 다른 청킹이 적재된다. 청크 수가 어긋나면 재분석 요구.
  const previewChunks = Number(String(form.get("previewChunks") || "")) || 0;
  if (previewChunks > 0 && previewChunks !== doc.articles.length) {
    return NextResponse.json({
      error: `제목·분류 변경으로 청킹이 미리보기와 달라졌습니다(미리보기 ${previewChunks} → 현재 ${doc.articles.length}청크). [분석/미리보기]를 다시 실행해 확인한 뒤 적재해 주세요.`,
      needsRepreview: true, audit,
    }, { status: 409 });
  }

  // 커밋 전 구간(기존본 조회→저장→삭제→검색목록→그래프→후처리→스모크)을 통째로 제목 락 안에서.
  // save·delete만 감싸면 그래프 재구축(임베딩+LLM, 수십 초~수 분)이 락 밖에서 병행돼, 같은 제목
  // 재커밋 시 먼저 시작한 느린 재구축이 나중 버전의 벡터·엣지를 옛 버전 계산으로 덮는다(P0).
  // prev(메타 승계·audit 이력)도 락 안에서 읽어야 직렬화된 앞 커밋의 기록이 유실되지 않는다.
  const articles = doc.articles.map((a) => ({ name: a.name, fullText: a.fullText, order: a.order, page: a.page }));
  const out = await withTitleLock(doc.title, async () => {
    // 교체 전 기존본 메타·위계 확보 — 시행일·연번이 공란이면 기존값 승계(교체로 인한 메타 유실 방지) + 위계 부모 유지.
    const prev = await RagRegulationModel.findOne({ title: doc.title }).select("year docNumber metadata.auditHistory metadata.smokeQuestions").lean<{ year?: string; docNumber?: string; metadata?: { auditHistory?: unknown[]; smokeQuestions?: string[] } }>();
    const effYear = doc.year || prev?.year || "";
    const effDocNumber = doc.docNumber || prev?.docNumber || "";
    const inherited = { year: !doc.year && !!prev?.year, docNumber: !doc.docNumber && !!prev?.docNumber };
    let directParent: string | undefined;
    try {
      const h = await mongoose.connection?.db?.collection(collectionName("ragGraphEdges")).findOne({ kind: "hier", sdoc: doc.title }, { projection: { tdoc: 1 } });
      directParent = (h as { tdoc?: string } | null)?.tdoc || undefined;
    } catch { /* 위계 미적재 */ }

    // 교체 순서: 새 문서를 먼저 저장한 뒤 옛 버전을 지운다. 삭제가 먼저면 save 실패(연결 단절·
    // BSON 상한 등) 시 기존본까지 사라진 채 남는다 — 실패해도 항상 "최소 한 버전"이 존재하게.
    // 검수 이력을 문서에 남긴다 — 적재 순간에만 존재하던 audit이 사라져, 청킹 붕괴를 사후에
    // 알아챌 수단이 없었다(표 행 유실이 어떤 지표에도 안 걸린 원인). 최근 5회 보관.
    const effSmoke = smokeQuestions.length ? smokeQuestions : (prev?.metadata?.smokeQuestions ?? []);
    const auditRec = { at: new Date().toISOString(), score: audit.score, retentionPct: audit.retentionPct, retentionCorePct: audit.retentionCorePct, chunks: audit.chunks, flags: audit.flags };
    const auditHistory = [...(prev?.metadata?.auditHistory ?? []).slice(-4), auditRec];
    const created = new RagRegulationModel({
      title: doc.title, year: effYear, category: doc.category, docNumber: effDocNumber,
      content: doc.title, articles,
      metadata: { ...doc.metadata, ingestedVia: "admin", ...(chunkKnobsInherited ? { chunkKnobsInherited } : {}), audit: auditRec, auditHistory, smokeQuestions: effSmoke },
    });
    await created.save();
    // 락이 깨지는 조건(dev HMR 모듈 재로드·다중 프로세스)에서도 교차 삭제가 서로의 신판을 지워
    // 0건이 되지 않게, "나보다 먼저 만들어진 버전"만 지운다 — 최후 생성본이 항상 살아남는다.
    const createdAt = (created.get("createdAt") as Date | undefined) ?? new Date();
    const del = await RagRegulationModel.deleteMany({
      title: doc.title, _id: { $ne: created._id },
      $or: [{ createdAt: { $lt: createdAt } }, { createdAt: { $exists: false } }],
    });
    const replaced = del.deletedCount || 0;

    // 검색 목록 재생성 실패가 뒤의 후처리 체인(그래프·표태깅·근거격리·상태집계)을 통째로 멈추면 안 된다.
    let sagyuCount = -1;
    let sagyuError: string | undefined;
    try { sagyuCount = await buildSagyuFromDb(); }
    catch (e) { sagyuError = e instanceof Error ? e.message : String(e); console.error("buildSagyuFromDb(ingest)", e); }
    // 임베딩·지식그래프 갱신 — 해당 문서 재임베딩(rag_vectors) + 참조/법령 엣지 재구성 + 위계 유지. 실패해도 적재 자체는 성공 처리.
    let graph: Awaited<ReturnType<typeof updateGraphForDoc>> | null = null;
    try { graph = await updateGraphForDoc(doc.title, directParent); }
    catch (e) { console.error("updateGraphForDoc(ingest)", e); }
    // 표 태깅(articles 교체로 소실된 태그·명제 복원) → 근거 영향 판정(어긋난 근거 격리) → 상태 집계.
    // 수동 CRUD 경로와 같은 헬퍼를 쓴다 — 경로마다 따로 챙기면 반드시 빠진다.
    const fin = await finalizeDocChange(doc.title);
    // 예상 질문 스모크 — 적재가 검색을 깨뜨렸는지 그 자리에서 확인(회수만, LLM 무관, 수 초).
    const smoke = effSmoke.length ? await runSmokeQuestions(doc.title, effSmoke) : null;
    return { created, replaced, effYear, effDocNumber, inherited, sagyuCount, sagyuError, graph, fin, smoke };
  });
  return NextResponse.json({ ok: true, mode: "commit", smoke: out.smoke, id: String(out.created._id), title: doc.title, category: doc.category, year: out.effYear, docNumber: out.effDocNumber, inherited: out.inherited, chunkKnobsInherited, chunks: articles.length, replaced: out.replaced, audit, sagyuCount: out.sagyuCount, sagyuError: out.sagyuError, graph: out.graph, ...out.fin });
}
