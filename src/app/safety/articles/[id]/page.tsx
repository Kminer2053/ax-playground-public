import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { SafetyArticleModel } from "@/models/SafetyArticle";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";

export default async function SafetyArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();
  await connectDb();
  const article = await SafetyArticleModel.findById(id).lean();
  if (!article) notFound();
  const backHref = article.type === "news" ? "/safety/news" : "/safety/library";
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href={backHref} className="text-gray-500 hover:text-[var(--brand-blue)]">← 목록</Link>
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h1 className="text-xl font-bold border-b border-gray-100 pb-3 mb-4">{article.title}</h1>
        <div className="text-gray-700 whitespace-pre-wrap">{article.content}</div>
      </div>
    </div>
  );
}
