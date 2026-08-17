/**
 * POST /api/admin/rag-cache — RAG 인메모리 캐시 새로고침(무중단 DB 교체용).
 * update-rag-db 스크립트로 rag_* 컬렉션만 교체한 뒤, 앱 재시작 없이
 * 벡터(rag_vectors 인메모리 코사인)·BM25 캐시를 비워 다음 질의부터 새 DB를 읽게 한다.
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { clearVectorCache } from "@/lib/regulations-vector";
import { clearBm25Cache } from "@/lib/regulations-bm25";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  clearVectorCache();
  clearBm25Cache();
  return NextResponse.json({ ok: true, cleared: ["rag_vectors(인메모리)", "bm25"], note: "다음 검색부터 새 DB 기준으로 재적재됩니다." });
}
