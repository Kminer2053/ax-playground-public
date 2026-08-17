import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { getConfigSecrets } from "@/lib/playgroundConfig";
import { verifyPassword } from "@/lib/postAuth";
import { isAdminIpAllowed } from "@/lib/adminIp";

/** ADMIN_ACCESS_KEY(env) 일치 여부 (타이밍 안전 비교). 키 미설정 시 항상 false. */
export function verifyAdminKey(key: string): boolean {
  const expected = env.ADMIN_ACCESS_KEY;
  if (!expected || typeof key !== "string" || key.length === 0) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 관리자 키 검증 — DB에 해시가 설정돼 있으면 그것으로(우선), 없으면 env 키로.
 * 관리자 → 설정에서 암호를 바꾸면 DB 해시가 생기고 그 이후로는 DB 기준.
 */
export async function verifyAdminKeyResolved(key: string): Promise<boolean> {
  if (typeof key !== "string" || key.length === 0) return false;
  try {
    const { adminKeyHash } = await getConfigSecrets();
    if (adminKeyHash) return verifyPassword(key, adminKeyHash);
  } catch {
    /* DB 실패 시 env 폴백 */
  }
  return verifyAdminKey(key);
}

/** 세션의 관리자 인증 여부 + 접속 IP 허용 여부(허용 IP 미설정 시 IP 제한 없음). 23개 관리자 API의 공통 초크포인트. */
export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  if (session.admin !== true) return false;
  return isAdminIpAllowed();
}

/**
 * 관리자 API 가드. 미인증이면 throw — 라우트에서 catch 없이 쓰도록
 * 401 응답 정보를 담은 에러를 던진다.
 */
export class AdminAuthError extends Error {
  readonly status = 401;
  constructor() {
    super("unauthorized");
    this.name = "AdminAuthError";
  }
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new AdminAuthError();
}

export function isAdminAuthError(e: unknown): e is AdminAuthError {
  return e instanceof AdminAuthError;
}
