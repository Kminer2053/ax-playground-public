/**
 * public/sagyu.json 재생성 — DB(rag_regulation) 기반. 관리자 적재 후 좌측 키워드검색 즉시 반영용.
 * (CLI의 --sagyu는 data/ 파일 기반; 관리자 적재는 DB가 출처이므로 이 함수를 사용.)
 */
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";

type Lean = { title?: string; year?: string; category?: string; docNumber?: string; articles?: { name: string; fullText?: string }[] };

/** DB 전체 → public/sagyu.json. 반환: 기록 건수. */
export async function buildSagyuFromDb(): Promise<number> {
  await connectDb();
  const docs = await RagRegulationModel.find({ category: { $nin: ["법령", "행정규칙"] } }) // 사규 목록에 외부규범 미포함
    .select("title year category docNumber articles").lean<Lean[]>();
  const items = docs.map((d) => {
    const arts = d.articles ?? [];
    const a = arts.map((x) => x.name);
    const af = arts.map((x) => ({ name: x.name, text: (x.fullText || "").slice(0, 3000) }));
    const w = [d.title ?? "", d.year ?? "", ...a, ...arts.map((x) => (x.fullText || "").slice(0, 3000))].join(" ");
    return { n: d.year ? `${d.title}(${d.year})` : (d.title ?? ""), s: d.title ?? "", a, af, w, c: d.category ?? "", no: d.docNumber ?? "" };
  });
  // 임시 파일에 다 쓴 뒤 rename — 도중 실패해도 서빙 중인 sagyu.json이 파손 JSON으로 남지 않는다.
  // tmp 이름은 호출마다 유일하게 — 고정 이름이면 동시 커밋(서로 다른 문서라도)이 같은 tmp를
  // 나눠 쓰다 파손본이 rename으로 승격될 수 있다(9MB라 부분 쓰기 창이 실재).
  const out = path.join(process.cwd(), "public", "sagyu.json");
  const tmp = `${out}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, JSON.stringify(items), "utf8");
  await rename(tmp, out);   // rename은 원자적 — 나중에 끝난 완전본이 이긴다
  return items.length;
}
