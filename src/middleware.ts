import { NextResponse, type NextRequest } from "next/server";

/**
 * AX Playground — 로그인 없음. 미들웨어는 인증 게이팅을 하지 않는다.
 * (관리자 보호는 /api/admin/* 라우트와 /admin 페이지 레벨에서 requireAdmin으로 수행)
 * 여기서는 API CORS 처리와 구 경로 리다이렉트만 담당한다.
 */

/** 별도 프론트(Vite 등)에서 API 호출 시 CORS 허용. 쉼표로 여러 origin 가능. */
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "";

function withCors(res: NextResponse, req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");
  const allowOrigin =
    CORS_ORIGIN && origin && CORS_ORIGIN.split(",").map((o) => o.trim()).includes(origin)
      ? origin
      : CORS_ORIGIN.split(",")[0]?.trim() || "";
  if (allowOrigin) {
    res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.headers.set("Access-Control-Max-Age", "86400");
  }
  return res;
}

const ANON_COOKIE = "ax_anon";
/** 무로그인 rate-limit 버킷용 익명 식별자 쿠키를 없으면 발급(httpOnly·1년). */
function ensureAnonId(res: NextResponse, req: NextRequest): NextResponse {
  if (!req.cookies.get(ANON_COOKIE)) {
    res.cookies.set(ANON_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

/** 구(로그인 시절) 경로 — 메인으로 보낸다. 물리 삭제는 P11. */
const LEGACY_REDIRECTS = new Set(["/login", "/setup"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api")) {
    if (req.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      return withCors(res, req);
    }
    const res = NextResponse.next();
    return ensureAnonId(withCors(res, req), req);
  }

  // 데스크톱 전용 전환: 모바일 라우트·구 로그인 경로 → 메인
  if (
    LEGACY_REDIRECTS.has(pathname) ||
    pathname === "/m" ||
    pathname.startsWith("/m/") ||
    pathname.startsWith("/mobile")
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return ensureAnonId(NextResponse.next(), req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
