import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { env } from "@/lib/env";

/**
 * AX Playground는 로그인이 없다. 세션은 관리자 인증 플래그 전용으로만 사용한다.
 * (POST /api/admin/auth 에서 ADMIN_ACCESS_KEY 검증 후 admin=true 저장)
 */
export type AxSession = IronSession<{
  admin?: boolean;
}>;

const sessionOptions: SessionOptions = {
  password: env.SESSION_SECRET,
  cookieName: "ax_portal_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
};

export async function getSession(): Promise<AxSession> {
  const cookieStore = await cookies();
  return getIronSession(cookieStore, sessionOptions);
}
