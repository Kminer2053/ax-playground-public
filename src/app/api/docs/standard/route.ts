import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 선택한 양식의 표준 hwpx 바이트를 그대로 서빙 — 문서작성 패널 ①표준양식 미리보기(rhwp)용.
const TPL_DIR = path.join(process.cwd(), "tools", "hwpx", "templates");
const FORM_DIR: Record<string, string> = {
  "1p": "format_1p",
  full: "format_full",
  gongmun: "format_gongmun",
  press: "format_press",
};

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "";
  const dir = FORM_DIR[format];
  if (!dir) {
    return NextResponse.json({ error: "표준양식이 없는 양식입니다." }, { status: 404 });
  }
  try {
    const buf = await readFile(path.join(TPL_DIR, dir, "standard.hwpx"));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/hwp+zip",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "표준양식 파일을 찾을 수 없습니다." }, { status: 404 });
  }
}
