import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { type NextRequest } from "next/server";
import { resolveUploadDiskPath } from "@/lib/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  zip: "application/zip",
  hwpx: "application/hwp+zip",
  hwp: "application/x-hwp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function contentType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

/** GET /uploads/* — 업로드 파일 스트리밍(Range 지원). next start에서 정적 404 시 폴백. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  if (!segments?.length) return new Response("Not found", { status: 404 });

  const disk = resolveUploadDiskPath(segments.join("/"));
  if (!disk) return new Response("Forbidden", { status: 403 });

  let size: number;
  try {
    const st = await stat(disk);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const type = contentType(disk);
  const baseHeaders: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const start = m[1] ? Number.parseInt(m[1], 10) : 0;
    const end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const safeEnd = Math.min(end, size - 1);
    const len = safeEnd - start + 1;
    const fh = await open(disk, "r");
    try {
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      return new Response(buf, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(len),
          "Content-Range": `bytes ${start}-${safeEnd}/${size}`,
        },
      });
    } finally {
      await fh.close();
    }
  }

  const stream = createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
