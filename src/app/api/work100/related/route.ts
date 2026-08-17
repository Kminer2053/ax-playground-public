import { NextResponse } from "next/server";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/work100/related?q=<질문> — 지식검색 답변에 붙일 관련 업무 카드(무로그인 공개).
 * LLM 미사용 결정적 토큰 매칭(라벨×3 + 기능×1 + 설명×1) 상위 3. 상태 무관(배지로 구분 표시).
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ tasks: [] });
  await connectDb();

  const toks = [...new Set(q.split(/[\s·,.?!()「」'"]+/).filter((w) => w.length >= 2))];
  if (!toks.length) return NextResponse.json({ tasks: [] });

  const nodes = await OntologyNodeModel.find({ type: "Task" })
    .select("id label status props")
    .lean<{ id: string; label: string; status?: string; props?: { dept?: string; desc?: string; fn?: string; org?: string } }[]>();

  const scored = nodes
    .map((n) => {
      const label = n.label ?? "";
      const fn = n.props?.fn ?? "";
      const desc = n.props?.desc ?? "";
      let s = 0;
      for (const t of toks) {
        if (label.includes(t)) s += 3;
        if (fn.includes(t)) s += 1;
        if (desc.includes(t)) s += 1;
      }
      return { n, s };
    })
    .filter((x) => x.s >= 3) // 라벨 1히트 이상 수준만(약한 우연 매칭 배제)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);

  return NextResponse.json({
    tasks: scored.map(({ n }) => ({
      id: n.id,
      label: n.label,
      dept: n.props?.dept ?? "",
      org: n.props?.org ?? "본사",
      fn: n.props?.fn ?? "",
      status: n.status ?? "candidate",
    })),
  });
}
