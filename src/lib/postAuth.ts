import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 게시물/댓글 비밀번호 해시 — 로그인 없는 익명 게시판용.
 * 등록자가 정한 비밀번호로 본인 글 수정/삭제. 관리자는 비번 없이 전체 관리(별도 isAdmin).
 * scrypt(salt 포함) — 폐쇄망 내부 도구 수준의 안전한 단방향 해시.
 */
export function hashPassword(pw: string): string {
  const p = (pw || "").trim();
  if (!p) return "";
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(p, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const p = (pw || "").trim();
  if (!p || !stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(p, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
