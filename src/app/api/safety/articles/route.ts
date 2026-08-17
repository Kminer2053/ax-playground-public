import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { SafetyArticleModel } from "@/models/SafetyArticle";
import { canManageSafety, sanitizeAttachments } from "@/lib/safety";

export async function GET(req: Request) {
  await connectDb();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = type === "news" || type === "library" ? { type } : {};
  const items = await SafetyArticleModel.find(q).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json({ ok: true, items: items.map((x) => ({ _id: String(x._id), title: x.title, content: x.content, type: x.type, imageUrl: x.imageUrl ?? "", attachments: Array.isArray(x.attachments) ? x.attachments : [], createdAt: x.createdAt })) });
}

export async function POST(req: Request) {
  await connectDb();
  const body = await req.json().catch(() => ({}));
  if (!(await canManageSafety(typeof body.password === "string" ? body.password : ""))) {
    return NextResponse.json({ error: "권한이 없습니다. 관리 비밀번호를 확인하세요." }, { status: 401 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const type = body.type === "news" || body.type === "library" ? body.type : "news";
  if (!title || !content) return NextResponse.json({ error: "title, content required" }, { status: 400 });
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  const attachments = sanitizeAttachments(body.attachments);
  const doc = await SafetyArticleModel.create({ title, content, type, imageUrl, attachments });
  return NextResponse.json({ ok: true, id: String(doc._id) }, { status: 201 });
}
