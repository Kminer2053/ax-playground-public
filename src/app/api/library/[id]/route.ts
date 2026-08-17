import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";
import { isAdmin } from "@/lib/adminAuth";
import { deleteUploadByUrl, saveUpload } from "@/lib/upload";
import { verifyPassword } from "@/lib/postAuth";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** POST /api/library/[id] — 조회/다운로드 카운트 증가 (익명). body: { kind: "view" | "download" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  const field = body?.kind === "download" ? "downloadCount" : body?.kind === "view" ? "viewCount" : null;
  if (!field) return NextResponse.json({ error: "kind은 view|download" }, { status: 400 });
  await connectDb();
  const doc = await LibraryPostModel.findByIdAndUpdate(id, { $inc: { [field]: 1 } }, { new: true }).select(field);
  if (!doc) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  recordUsage("library", "view"); // 게시물 열람/다운로드
  return NextResponse.json({ ok: true, [field]: (doc as Record<string, number>)[field] });
}

/**
 * PATCH /api/library/[id] — 수정 또는 고정.
 *  - JSON: { pinned } | { title?, content?, usage?, password? }
 *  - multipart: 본문 수정 + 썸네일(thumbnail/removeThumbnail) + 자료실 첨부(files/removeAttachments)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  const ct = req.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  let thumb: File | null = null;
  let removeThumb = false;
  let form: FormData | null = null;

  if (ct.includes("multipart/form-data")) {
    try { form = await req.formData(); }
    catch { return NextResponse.json({ error: "multipart/form-data 형식이 필요합니다." }, { status: 400 }); }
    body = {
      title: form.get("title"),
      content: form.get("content"),
      usage: form.get("usage"),
      password: form.get("password"),
    };
    const t = form.get("thumbnail");
    if (t instanceof File && t.size > 0) thumb = t;
    if (form.get("removeThumbnail") === "1") removeThumb = true;
  } else {
    body = (await req.json().catch(() => null)) as Record<string, unknown> | null ?? {};
  }

  if (!body || typeof body !== "object") return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  await connectDb();
  const doc = await LibraryPostModel.findById(id);
  if (!doc) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  const admin = await isAdmin();

  if (typeof body.pinned === "boolean") {
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    doc.pinned = body.pinned;
    await doc.save();
    return NextResponse.json({ ok: true, pinned: doc.pinned });
  }

  const authed = admin || verifyPassword(String(body.password || ""), doc.passwordHash || "");
  if (!authed) return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 403 });
  if (typeof body.title === "string" && body.title.trim()) doc.title = body.title.trim().slice(0, 200);
  if (typeof body.content === "string" && body.content.trim()) doc.content = body.content.trim();
  if (typeof body.usage === "string") doc.usage = body.usage.trim();

  try {
    if (thumb) {
      await deleteUploadByUrl(doc.thumbnailUrl);
      doc.thumbnailUrl = (await saveUpload(thumb, "image", doc.board)).url;
    } else if (removeThumb && doc.thumbnailUrl) {
      await deleteUploadByUrl(doc.thumbnailUrl);
      doc.thumbnailUrl = "";
    }

    if (form && doc.board === "file") {
      let removeUrls: string[] = [];
      const raw = form.get("removeAttachments");
      if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) removeUrls = parsed.filter((u): u is string => typeof u === "string" && u.length > 0);
        } catch { /* ignore */ }
      }
      const atts = (doc.attachments || []) as { name: string; size: number; url: string }[];
      const existing = new Set(atts.map((a) => a.url));
      for (const url of removeUrls) {
        if (!existing.has(url)) continue;
        await deleteUploadByUrl(url);
      }
      if (removeUrls.length) {
        const drop = new Set(removeUrls);
        doc.attachments = atts.filter((a) => !drop.has(a.url));
      }

      const newFiles = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      if (newFiles.length > 10) return NextResponse.json({ error: "첨부 파일은 최대 10개까지입니다." }, { status: 400 });
      if ((doc.attachments?.length || 0) + newFiles.length > 10) {
        return NextResponse.json({ error: "첨부 파일은 최대 10개까지입니다." }, { status: 400 });
      }
      for (const f of newFiles) {
        const s = await saveUpload(f, "file", doc.board);
        doc.attachments = [...(doc.attachments || []), { name: s.name, size: s.size, url: s.url }];
      }
      if ((doc.attachments?.length || 0) === 0) {
        return NextResponse.json({ error: "첨부 파일을 1개 이상 유지하세요." }, { status: 400 });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드 실패" }, { status: 400 });
  }

  await doc.save();
  return NextResponse.json({ ok: true, thumbnailUrl: doc.thumbnailUrl, attachments: doc.attachments });
}

/** DELETE /api/library/[id] — 관리자 또는 비밀번호. body(optional): { password } */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  await connectDb();
  const doc = await LibraryPostModel.findById(id);
  if (!doc) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  if (!(await isAdmin())) {
    const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
    if (!verifyPassword(String(body?.password || ""), doc.passwordHash || "")) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 403 });
    }
  }
  await doc.deleteOne();
  await deleteUploadByUrl(doc.thumbnailUrl);
  await deleteUploadByUrl(doc.fileUrl);
  for (const a of doc.attachments || []) await deleteUploadByUrl(a.url);
  return NextResponse.json({ ok: true });
}
