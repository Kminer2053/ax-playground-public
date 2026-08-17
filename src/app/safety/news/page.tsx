import Link from "next/link";
import { connectDb } from "@/lib/db";
import { SafetyArticleModel } from "@/models/SafetyArticle";

export const dynamic = "force-dynamic";

export default async function SafetyNewsPage() {
  await connectDb();
  const items = await SafetyArticleModel.find({ type: "news" }).sort({ createdAt: -1 }).limit(50).lean();
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/safety" className="text-gray-500 hover:text-[var(--brand-blue)]">← 안전</Link>
      <h1 className="text-2xl font-bold">안전뉴스</h1>
      <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
        {items.length === 0 ? <li className="p-8 text-center text-gray-500">등록된 뉴스가 없습니다.</li> : items.map((x) => (
          <li key={String(x._id)} className="p-4 hover:bg-gray-50">
            <Link href={`/safety/articles/${x._id}`} className="block">
              <div className="font-semibold text-gray-900">{x.title}</div>
              <div className="text-sm text-gray-500 mt-1 line-clamp-1">{x.content}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
