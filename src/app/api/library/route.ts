import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";
import { normalizeNickname } from "@/lib/nickname";
import { saveUpload } from "@/lib/upload";
import { hashPassword } from "@/lib/postAuth";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

const BOARDS = ["prompt", "video", "file"] as const;
type Board = (typeof BOARDS)[number];
function isBoard(v: unknown): v is Board {
  return typeof v === "string" && (BOARDS as readonly string[]).includes(v);
}

/** lean 문서 → 카드 응답. 비밀해시·투표자 제거, 댓글은 해시 제외하고 hasPassword만 노출. */
function toCard(d: Record<string, unknown>) {
  const { _id, __v, voters, passwordHash, comments, ...rest } = d;
  void __v; void voters;
  const cs = Array.isArray(comments) ? (comments as Record<string, unknown>[]) : [];
  return {
    id: String(_id),
    ...rest,
    hasPassword: !!passwordHash,
    comments: cs.map((c) => ({
      id: String(c._id),
      author: c.author,
      content: c.content,
      createdAt: c.createdAt,
      hasPassword: !!c.passwordHash,
    })),
  };
}

/** GET /api/library?board=prompt&q=&sort=latest|popular|views&limit=50 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const board = searchParams.get("board");
  if (!isBoard(board)) return NextResponse.json({ error: "board는 prompt|video|file" }, { status: 400 });
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);
  const q = (searchParams.get("q") || "").trim();
  const sortKey = searchParams.get("sort") || "latest";
  const filter: Record<string, unknown> = { board };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ title: rx }, { content: rx }];
  }
  const sortSpec: Record<string, 1 | -1> =
    sortKey === "popular" ? { pinned: -1, up: -1, createdAt: -1 }
    : sortKey === "views" ? { pinned: -1, viewCount: -1, createdAt: -1 }
    : { pinned: -1, createdAt: -1 };
  await connectDb();
  const items = await LibraryPostModel.find(filter).sort(sortSpec).limit(limit).select("-voters").lean();
  return NextResponse.json({ ok: true, items: items.map((d) => toCard(d as Record<string, unknown>)) });
}

/** POST /api/library — 등록 (multipart). file 보드는 files[] 다중첨부, video는 file 단일. password 선택. */
export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "multipart/form-data 형식이 필요합니다." }, { status: 400 }); }

  const board = form.get("board");
  if (!isBoard(board)) return NextResponse.json({ error: "board는 prompt|video|file" }, { status: 400 });

  const title = String(form.get("title") || "").trim();
  const content = String(form.get("content") || "").trim();
  const usage = String(form.get("usage") || "").trim();
  const author = normalizeNickname(form.get("author"));
  const password = String(form.get("password") || "");
  if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const thumb = form.get("thumbnail");
  let thumbnailUrl = "";
  let fileUrl = "";
  let fileName = "";
  let fileSize = 0;
  const attachments: { name: string; size: number; url: string }[] = [];

  try {
    if (thumb instanceof File && thumb.size > 0) {
      thumbnailUrl = (await saveUpload(thumb, "image", board)).url;
    }
    if (board === "video") {
      const v = form.get("file");
      if (!(v instanceof File) || v.size === 0) return NextResponse.json({ error: "영상 파일(mp4 등)이 필요합니다." }, { status: 400 });
      const s = await saveUpload(v, "video", board);
      fileUrl = s.url; fileName = s.name; fileSize = s.size;
    } else if (board === "file") {
      const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) return NextResponse.json({ error: "첨부 파일을 1개 이상 추가하세요." }, { status: 400 });
      if (files.length > 10) return NextResponse.json({ error: "첨부 파일은 최대 10개까지입니다." }, { status: 400 });
      for (const f of files) {
        const s = await saveUpload(f, "file", board);
        attachments.push({ name: s.name, size: s.size, url: s.url });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드 실패" }, { status: 400 });
  }

  await connectDb();
  const doc = await LibraryPostModel.create({
    board, title, content, usage, author,
    thumbnailUrl, fileUrl, fileName, fileSize, attachments,
    passwordHash: hashPassword(password),
  });
  recordUsage("library", "post"); // 게시물 등록 실행 계측
  return NextResponse.json({ ok: true, id: String(doc._id) });
}
