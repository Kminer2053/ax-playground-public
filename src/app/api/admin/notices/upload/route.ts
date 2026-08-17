/**
 * 공지 이미지 업로드(admin) — 폐쇄망이라 외부 URL을 쓸 수 없어 로컬 디스크에 저장한다.
 *
 * 검증(확장자 화이트리스트·실행파일 차단·용량 제한·디스크 여유)은 saveUpload가 이미 한다.
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { saveUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "multipart/form-data 형식이 필요합니다." }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });

  try {
    const s = await saveUpload(file, "image", "notice");
    return NextResponse.json({ ok: true, url: s.url, name: s.name, size: s.size });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 실패" }, { status: 400 });
  }
}
