import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { connectDb } from "@/lib/db";
import { env } from "@/lib/env";
import { AuditLogModel } from "@/models/AuditLog";
import type { GuardContext } from "../types";

/**
 * M09: 감사 로그 이중 기록 (파일 + MongoDB).
 * - fire-and-forget + fail-open: 로그 기록 실패가 사용자 요청을 막지 않는다.
 * - 파일 경로는 AUDIT_LOG_FILE (기본 /var/log/axp-audit.log).
 */

const DEFAULT_AUDIT_FILE = "/var/log/axp-audit.log";

export type AuditEntry = {
  ctx: GuardContext;
  outcome: "pass" | "blocked" | "error";
  stage?: "input" | "model" | "output" | null;
  ruleId?: string | null;
  inputText: string;
  outputText?: string | null;
  maskedTypes?: string[];
  latencyMs: number;
};

let fileWarned = false;

function auditFilePath(): string {
  return env.AUDIT_LOG_FILE ?? DEFAULT_AUDIT_FILE;
}

/** 실제 파일 append 1회 — 디렉터리 없으면 생성 후 재시도. */
async function appendOnce(line: string): Promise<void> {
  const path = auditFilePath();
  try {
    await appendFile(path, line + "\n", "utf8");
  } catch {
    // 디렉터리 부재 시 1회 생성 재시도
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, line + "\n", "utf8");
    } catch (e) {
      if (!fileWarned) {
        fileWarned = true;
        console.warn(
          `[audit] 파일 로그 기록 실패(${path}). 이후 파일 기록은 생략하고 DB만 사용합니다.`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}

// 단일 writer 체인 — 동시 호출의 append를 직렬화해 JSONL 줄 인터리브(깨짐)를 방지(전문 기록 시 한 줄이 길어 특히 중요).
let _fileChain: Promise<void> = Promise.resolve();

/** 파일에 한 줄 JSON(JSONL) 추가. 직렬화되어 한 번에 한 줄씩 기록된다. */
function writeFileLog(line: string): Promise<void> {
  const next = _fileChain.then(() => appendOnce(line));
  _fileChain = next.catch(() => {}); // 한 건 실패가 이후 기록을 막지 않도록
  return next;
}

async function writeDbLog(record: Record<string, unknown>): Promise<void> {
  try {
    await connectDb();
    await AuditLogModel.create(record);
  } catch (e) {
    console.warn("[audit] DB 로그 기록 실패:", e instanceof Error ? e.message : e);
  }
}

/**
 * 감사 로그 1건 기록. await 하지 않고 호출해도 되도록 자체적으로 예외를 삼킨다.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const fullText = env.AUDIT_LOG_FULL_TEXT;
  const ts = new Date().toISOString();

  const base = {
    ts,
    requestId: entry.ctx.requestId,
    userId: entry.ctx.userId,
    role: entry.ctx.role,
    ip: entry.ctx.ip,
    panel: entry.ctx.panel,
    outcome: entry.outcome,
    stage: entry.stage ?? null,
    ruleId: entry.ruleId ?? null,
    inputLen: entry.inputText.length,
    outputLen: entry.outputText?.length ?? 0,
    maskedTypes: entry.maskedTypes ?? [],
    latencyMs: entry.latencyMs,
  };

  const record = {
    ...base,
    createdAt: undefined as unknown, // mongoose timestamps가 채움
    inputText: fullText ? entry.inputText : null,
    outputText: fullText ? (entry.outputText ?? null) : null,
  };
  delete (record as Record<string, unknown>).createdAt;

  // 파일 로그(JSONL)와 DB 로그를 병렬로, 실패해도 무시.
  await Promise.allSettled([
    writeFileLog(JSON.stringify({ ...base, ...(fullText ? { inputText: entry.inputText, outputText: entry.outputText ?? null } : {}) })),
    writeDbLog(record),
  ]);
}
