import { isAdmin } from "@/lib/adminAuth";
import { getConfigSecrets } from "@/lib/playgroundConfig";
import { verifyPassword } from "@/lib/postAuth";

/**
 * 안전 게시판(뉴스/자료) 관리 권한.
 * 관리자 세션이거나, 관리자 페이지에서 설정한 게시판 비밀번호가 일치하면 true.
 * 비밀번호가 설정돼 있지 않으면 관리자만 관리 가능.
 */
export async function canManageSafety(password?: string): Promise<boolean> {
  if (await isAdmin()) return true;
  const pw = (password || "").trim();
  if (!pw) return false;
  try {
    const { safetyBoardPwHash } = await getConfigSecrets();
    return safetyBoardPwHash ? verifyPassword(pw, safetyBoardPwHash) : false;
  } catch {
    return false;
  }
}

/** 첨부 배열 정제 — {name,size,url} 형태만, 최대 20개. */
export function sanitizeAttachments(v: unknown): { name: string; size: number; url: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as Record<string, unknown>).url === "string" && !!(a as Record<string, unknown>).url)
    .slice(0, 20)
    .map((a) => ({ name: String(a.name || "파일"), size: Number(a.size) || 0, url: String(a.url) }));
}
