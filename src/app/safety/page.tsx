import Link from "next/link";
import { connectDb } from "@/lib/db";
import { SafetyArticleModel } from "@/models/SafetyArticle";

export const dynamic = "force-dynamic";

export default async function SafetyHomePage() {
  await connectDb();
  const [news, library] = await Promise.all([
    SafetyArticleModel.find({ type: "news" }).sort({ createdAt: -1 }).limit(5).lean(),
    SafetyArticleModel.find({ type: "library" }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-[var(--brand-blue)]">대시보드</Link>
        <Link href="/panel/safety" className="text-sm text-gray-500 hover:text-[var(--brand-blue)]">안전 패널(목업)</Link>
      </div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <span className="material-symbols-outlined text-[var(--brand-blue)]">health_and_safety</span>안전
      </h1>
      <div className="grid md:grid-cols-3 gap-6">
        <Link href="/safety/chat" className="bg-white rounded-2xl border border-gray-200 p-6 hover:border-[var(--brand-blue)] hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-green-600 text-2xl">smart_toy</span>
          </div>
          <h2 className="font-bold text-gray-900">스마트안전챗봇</h2>
          <p className="text-sm text-gray-500 mt-1">안전 관련 질문에 AI가 답변합니다.</p>
        </Link>
        <Link href="/safety/news" className="bg-white rounded-2xl border border-gray-200 p-6 hover:border-[var(--brand-blue)] hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-amber-600 text-2xl">new_releases</span>
          </div>
          <h2 className="font-bold text-gray-900">안전뉴스</h2>
          <p className="text-sm text-gray-500 mt-1">안전 관련 뉴스·공지 ({news.length}건)</p>
        </Link>
        <Link href="/safety/library" className="bg-white rounded-2xl border border-gray-200 p-6 hover:border-[var(--brand-blue)] hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-blue-600 text-2xl">folder_shared</span>
          </div>
          <h2 className="font-bold text-gray-900">안전자료실</h2>
          <p className="text-sm text-gray-500 mt-1">매뉴얼·자료 ({library.length}건)</p>
        </Link>
      </div>
    </div>
  );
}
