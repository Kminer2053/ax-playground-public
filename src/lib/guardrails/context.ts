import type { GuardContext, GuardPanel } from "./types";

/** Request 헤더에서 클라이언트 IP·requestId 추출 (Nginx X-Forwarded-For/X-Real-IP). */
export function extractRequestMeta(
  req: Request,
  panel: GuardPanel,
): Pick<GuardContext, "ip" | "panel" | "requestId"> {
  const xff = req.headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0]?.trim() : null) ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  return { ip, panel, requestId };
}

/**
 * 라우트 핸들러용 편의 헬퍼: 요청 메타로 GuardContext를 만든다.
 * AX Playground는 로그인이 없으므로 사용자 식별은 없고(userId/role=null),
 * rate limit 등 사용자 단위 가드는 IP 버킷으로 동작한다.
 */
/** 요청 Cookie 헤더에서 단일 쿠키 값 추출. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

export async function buildGuardContext(req: Request, panel: GuardPanel): Promise<GuardContext> {
  const meta = extractRequestMeta(req, panel);
  return {
    userId: null,
    role: null,
    // 무로그인: 익명 쿠키로 사용자 단위 rate-limit 버킷을 분리(없으면 ratelimit가 IP로 폴백).
    clientId: readCookie(req, "ax_anon"),
    // 클라이언트 연결 끊기면 발화 → LLM 호출 즉시 취소(H3).
    signal: req.signal,
    ...meta,
  };
}
