import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AuditLogModel } from "@/models/AuditLog";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/guardrails/logs/[id] — 감사 로그 1건의 입력·생성 전문(admin 전용).
 * 목록은 메타만 반환하므로, 텍스트는 모달 열람 시 이 엔드포인트로 lazy-load 한다.
 * inputText/outputText 는 AUDIT_LOG_FULL_TEXT=true 일 때만 채워져 있다(아니면 null).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  await connectDb();
  const doc = await AuditLogModel.findById(id)
    .select("createdAt outcome stage ruleId panel inputText outputText inputLen outputLen maskedTypes")
    .lean<{
      createdAt: Date;
      outcome: string;
      stage: string | null;
      ruleId: string | null;
      panel: string;
      inputText: string | null;
      outputText: string | null;
      inputLen: number;
      outputLen: number;
      maskedTypes: string[];
    } | null>()
    .exec();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    at: new Date(doc.createdAt).toISOString(),
    outcome: doc.outcome,
    stage: doc.stage,
    ruleId: doc.ruleId,
    panel: doc.panel,
    inputText: doc.inputText,
    outputText: doc.outputText,
    inputLen: doc.inputLen,
    outputLen: doc.outputLen,
    maskedTypes: doc.maskedTypes ?? [],
  });
}
