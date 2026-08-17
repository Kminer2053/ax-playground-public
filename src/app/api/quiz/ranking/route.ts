import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { QuizRankingModel } from "@/models/QuizRanking";
import { normalizeNickname } from "@/lib/nickname";
import { isAdmin } from "@/lib/adminAuth";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

type RankRow = { rank: number; nickname: string; score: number; comboMax: number; playedAt: Date };

// 리더보드 마이크로 캐시(limit별 1.5초) — 실시간 폴링 다중사용 시 DB 읽기를 평탄화.
// 폐쇄망 단일서버라 프로세스 메모리로 충분(Redis 불필요).
const BOARD_TTL = 1500;
const boardCache = new Map<number, { at: number; ranking: RankRow[]; total: number }>();

async function getBoard(limit: number) {
  const hit = boardCache.get(limit);
  const now = Date.now();
  if (hit && now - hit.at < BOARD_TTL) return hit;
  const [rows, total] = await Promise.all([
    QuizRankingModel.find()
      .sort({ score: -1, comboMax: -1, playedAt: 1 })
      .limit(limit)
      .select("nickname score comboMax playedAt")
      .lean(),
    QuizRankingModel.countDocuments(),
  ]);
  const ranking: RankRow[] = rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: r.score,
    comboMax: r.comboMax,
    playedAt: r.playedAt,
  }));
  const entry = { at: now, ranking, total };
  boardCache.set(limit, entry);
  return entry;
}

/**
 * GET /api/quiz/ranking?limit=10[&forScore=1240]
 *  - ranking: Top N (1.5초 캐시)
 *  - forScore 지정 시 projected: 그 점수의 실시간 투영 순위(인덱스 카운트, 캐시 안 함).
 */
export async function GET(req: Request) {
  await connectDb();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 10, 1), 100);
  const board = await getBoard(limit);

  let projected: { rank: number; total: number } | undefined;
  const forScoreRaw = searchParams.get("forScore");
  if (forScoreRaw !== null) {
    const s = Number(forScoreRaw);
    if (Number.isFinite(s) && s >= 0) {
      // 동점 세부순위는 무시(라이브 표시용) — score 초과 인원 + 1.
      // total은 미등록 상태의 본인을 포함(+1) → "전체 N명 중 R위"가 R ≤ N으로 정합.
      const above = await QuizRankingModel.countDocuments({ score: { $gt: Math.floor(s) } });
      projected = { rank: above + 1, total: board.total + 1 };
    }
  }

  return NextResponse.json({ ok: true, ranking: board.ranking, total: board.total, projected });
}

/** POST /api/quiz/ranking — 결과 등록 {nickname?, score, comboMax}. 닉네임 미입력 시 랜덤 별명. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });

  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 0) return NextResponse.json({ error: "score가 올바르지 않습니다." }, { status: 400 });
  const comboRaw = Number(body.comboMax);
  const comboMax = Number.isFinite(comboRaw) && comboRaw >= 0 ? Math.floor(comboRaw) : 0;
  const nickname = normalizeNickname(body.nickname);

  await connectDb();
  const doc = await QuizRankingModel.create({ nickname, score: Math.floor(score), comboMax });
  boardCache.clear(); // 신규 등록 즉시 반영

  // 등록 결과의 순위 산정(점수↓ → 콤보↓ → 먼저 달성).
  const rank =
    (await QuizRankingModel.countDocuments({
      $or: [
        { score: { $gt: doc.score } },
        { score: doc.score, comboMax: { $gt: doc.comboMax } },
        { score: doc.score, comboMax: doc.comboMax, playedAt: { $lt: doc.playedAt } },
      ],
    })) + 1;
  const total = await QuizRankingModel.countDocuments();

  recordUsage("quiz", "complete"); // 퀴즈 완주(결과 등록)
  return NextResponse.json({ ok: true, nickname: doc.nickname, score: doc.score, comboMax: doc.comboMax, rank, total });
}

/** DELETE /api/quiz/ranking — 랭킹 전체 초기화 (admin). */
export async function DELETE() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const { deletedCount } = await QuizRankingModel.deleteMany({});
  boardCache.clear();
  return NextResponse.json({ ok: true, deleted: deletedCount });
}
