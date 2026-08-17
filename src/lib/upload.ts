import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { LIBRARY_FILE_EXTENSIONS } from "@/lib/libraryFileTypes";

/**
 * 업로드 파일 저장 — 폐쇄망 로컬 디스크.
 * URL은 /uploads/... (public 정적 또는 app/uploads 라우트).
 */
export const UPLOAD_URL_PREFIX = "/uploads";

export function getUploadRoot(): string {
  return env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
}

/** URL 경로(library/prompt/…) → 디스크 절대경로. 경로 탈출 시 null. */
export function resolveUploadDiskPath(relativeUrlPath: string): string | null {
  const rel = relativeUrlPath.replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return null;
  const root = path.resolve(getUploadRoot());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const SERVE_BASE = env.UPLOAD_DIR ? null : UPLOAD_URL_PREFIX;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "ogg"]);
const FILE_EXT = new Set<string>(LIBRARY_FILE_EXTENSIONS);
// 실행 파일류 차단(화이트리스트로도 막히지만 이중 안전장치).
const BLOCK_EXT = new Set(["exe", "bat", "cmd", "sh", "js", "mjs", "msi", "com", "scr", "ps1", "vbs", "jar"]);

export type UploadKind = "image" | "video" | "file";
export type SavedFile = { url: string; name: string; size: number };

function extOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

/** 업로드 1건 검증 + 저장. 실패 시 throw(Error.message는 사용자 노출용). */
export async function saveUpload(file: File, kind: UploadKind, board: string): Promise<SavedFile> {
  if (!file || file.size === 0) throw new Error("빈 파일입니다.");
  const ext = extOf(file.name);
  if (!ext || BLOCK_EXT.has(ext)) throw new Error("허용되지 않는 파일 형식입니다.");

  const allow = kind === "image" ? IMAGE_EXT : kind === "video" ? VIDEO_EXT : FILE_EXT;
  if (!allow.has(ext)) throw new Error(`허용 확장자: ${[...allow].join(", ")}`);

  const cfg = await getPlaygroundConfig().catch(() => null);
  const maxMb = kind === "image" ? (cfg?.uploadImageMb ?? 10) : (cfg?.uploadFileMb ?? 100);
  const max = maxMb * 1024 * 1024;
  if (file.size > max) throw new Error(`최대 ${maxMb}MB까지 업로드할 수 있습니다.`);

  const safeBoard = /^[a-z]+$/.test(board) ? board : "etc";
  const dir = path.join(getUploadRoot(), "library", safeBoard);
  await fs.mkdir(dir, { recursive: true });

  // 디스크 여유 공간 사전 점검 — 업로드 볼륨이 DB·감사로그와 공유되면 디스크 풀이 동반 장애가 된다.
  try {
    const st = await fs.statfs(dir);
    const free = st.bavail * st.bsize;
    const need = Math.max(file.size * 2, 200 * 1024 * 1024); // 파일 2배 또는 최소 200MB 여유
    if (free < need) throw new Error("서버 저장 공간이 부족합니다. 관리자에게 문의하세요.");
  } catch (e) {
    if (e instanceof Error && e.message.includes("저장 공간")) throw e;
    // statfs 미지원/조회 실패는 가용성 우선으로 통과
  }

  const filename = `${randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, filename), buf);

  if (!SERVE_BASE) {
    throw new Error("UPLOAD_DIR 커스텀 경로는 아직 서빙 라우트 미구현입니다.");
  }
  return { url: `${SERVE_BASE}/library/${safeBoard}/${filename}`, name: file.name, size: file.size };
}

/** 게시물 삭제 시 첨부 파일 best-effort 제거. */
export async function deleteUploadByUrl(url: string): Promise<void> {
  if (!url?.startsWith(`${UPLOAD_URL_PREFIX}/`)) return;
  const rel = url.slice(UPLOAD_URL_PREFIX.length + 1);
  const disk = resolveUploadDiskPath(rel);
  if (!disk) return;
  try {
    await fs.unlink(disk);
  } catch {
    /* 파일 없거나 권한 — 무시 */
  }
}
