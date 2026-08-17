import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const DIRS: Record<string, string> = {
  "1p": "format_1p",
  full: "format_full",
  gongmun: "format_gongmun",
  press: "format_press",
};

/** GET /api/admin/doc-templates/[format] — 현재 표준 hwpx 다운로드. */
export async function GET(_req: Request, { params }: { params: Promise<{ format: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { format } = await params;
  const dir = DIRS[format];
  if (!dir) return NextResponse.json({ error: "잘못된 양식" }, { status: 400 });

  let buf: Buffer;
  try {
    buf = await readFile(path.join(process.cwd(), "tools", "hwpx", "templates", dir, "standard.hwpx"));
  } catch {
    return NextResponse.json({ error: "표준 파일이 없습니다." }, { status: 404 });
  }
  const filename = `${format}_standard.hwpx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
