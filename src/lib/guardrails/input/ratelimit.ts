import { connectDb } from "@/lib/db";
import { GuardRateLimitModel } from "@/models/GuardRateLimit";
import type { GuardCheckResult, GuardContext } from "../types";

/**
 * GR1-4 (M14·M27): 요청 속도 제한.
 * - 1분 윈도우 / 사용자 또는 IP + 패널별 분리 / 최대 30회.
 * - MongoDB TTL 인덱스가 윈도우 만료 후 도큐먼트를 자동 삭제 → 별도 cleanup 불필요.
 * - 윈도우 시작시각을 키에 포함하여 race-free upsert.
 */
export const RATE_LIMIT_PER_WINDOW = 30;
export const RATE_LIMIT_WINDOW_SEC = 60;

function bucketKey(ctx: GuardContext, windowStartMs: number): string {
  // 로그인 사용자 > 익명 쿠키 > IP 순. 무로그인 환경에서 NAT 뒤 다수가 한 버킷을 공유하지 않도록.
  const identity = ctx.userId ? `u:${ctx.userId}` : ctx.clientId ? `c:${ctx.clientId}` : `ip:${ctx.ip}`;
  return `${identity}:${ctx.panel}:${windowStartMs}`;
}

export async function checkRateLimit(
  ctx: GuardContext,
  opts?: { perWindow?: number; windowSec?: number },
): Promise<GuardCheckResult> {
  await connectDb();

  const perWindow = opts?.perWindow ?? RATE_LIMIT_PER_WINDOW;
  const windowSec = opts?.windowSec ?? RATE_LIMIT_WINDOW_SEC;
  const now = Date.now();
  const windowMs = windowSec * 1_000;
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  // TTL 만료시각 = 윈도우 끝 + 10초 버퍼 (Mongo TTL job이 정확히 0초에 안 도는 점 보완).
  const expiresAt = new Date(windowStartMs + windowMs + 10_000);
  const key = bucketKey(ctx, windowStartMs);

  const doc = await GuardRateLimitModel.findOneAndUpdate(
    { key },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        panel: ctx.panel,
        windowStart: new Date(windowStartMs),
        expiresAt,
      },
    },
    { upsert: true, new: true },
  )
    .lean<{ count: number } | null>()
    .exec();

  const count = doc?.count ?? 0;
  if (count > perWindow) {
    const retryAfterSec = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1_000));
    return {
      ok: false,
      block: {
        stage: "input",
        reason: `요청 속도 제한 초과 (${windowSec}초당 ${perWindow}회). ${retryAfterSec}초 후 재시도.`,
        ruleId: "M14-M27-ratelimit",
        status: 429,
      },
    };
  }

  return { ok: true };
}
