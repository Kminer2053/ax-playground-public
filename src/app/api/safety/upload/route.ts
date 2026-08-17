import { NextResponse } from "next/server";
import { canManageSafety } from "@/lib/safety";
import { saveUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/safety/upload (multipart: file, kind=image|file, password)
 * 안전 게시판 이미지/첨부 업로드 — 관리자 또는 게시판 비밀번호 필요. { ok, url, name, size }.
 */
export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "multipart/form-data 형식이 필요합니다." }, { status: 400 }); }

  if (!(await canManageSafety(String(form.get("password") || "")))) {
    return NextResponse.json({ error: "권한이 없습니다. 관리 비밀번호를 확인하세요." }, { status: 401 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }
  const kind = form.get("kind") === "image" ? "image" : "file";
  try {
    const s = await saveUpload(file, kind, "safety");
    return NextResponse.json({ ok: true, url: s.url, name: s.name, size: s.size });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 실패" }, { status: 400 });
  }
}
