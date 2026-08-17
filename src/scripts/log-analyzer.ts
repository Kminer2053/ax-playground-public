/**
 * M09: AI 감사 로그 일일 분석 리포트 생성기.
 * 실행: npm run report:audit           → 어제 00:00 ~ 오늘 00:00 집계
 *      npm run report:audit -- 2026-06-08  → 특정일 집계
 *
 * cron 예시 (매일 09:00):
 *   0 9 * * * cd /opt/ax-portal && npm run report:audit >> /var/log/axp-report.log 2>&1
 *
 * 출력: ${REPORT_DIR or /data/reports}/audit-YYYY-MM-DD.md
 */
import dotenv from "dotenv";
import path from "path";
import { mkdir, writeFile } from "node:fs/promises";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local 또는 환경 변수를 설정하세요.");
  process.exit(1);
}

import mongoose from "mongoose";
import { AuditLogModel } from "../models/AuditLog";

const REPORT_DIR = process.env.REPORT_DIR ?? "/data/reports";

/** "YYYY-MM-DD" → 해당 로컬 자정 Date. 인자 없으면 어제. */
function resolveTargetDay(arg?: string): { start: Date; end: Date; label: string } {
  let start: Date;
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    start = new Date(`${arg}T00:00:00`);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { start, end, label };
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const { start, end, label } = resolveTargetDay(process.argv[2]);
  await mongoose.connect(MONGODB_URI!);

  const logs = await AuditLogModel.find({ createdAt: { $gte: start, $lt: end } })
    .lean<
      Array<{
        userId: string | null;
        ip: string | null;
        panel: string;
        outcome: "pass" | "blocked";
        stage: string | null;
        ruleId: string | null;
        latencyMs: number;
        maskedTypes: string[];
      }>
    >()
    .exec();

  const total = logs.length;
  const blocked = logs.filter((l) => l.outcome === "blocked");
  const passed = logs.filter((l) => l.outcome === "pass");

  // 룰별 차단 분포
  const ruleCount = new Map<string, number>();
  for (const l of blocked) {
    const key = (l.ruleId ?? "unknown").split(":")[0]; // 접두 룰ID로 묶음
    ruleCount.set(key, (ruleCount.get(key) ?? 0) + 1);
  }

  // 패널별 분포
  const panelCount = new Map<string, number>();
  for (const l of logs) panelCount.set(l.panel, (panelCount.get(l.panel) ?? 0) + 1);

  // 사용자별 차단 Top (의심행위)
  const userBlocks = new Map<string, number>();
  for (const l of blocked) {
    const key = l.userId ?? l.ip ?? "unknown";
    userBlocks.set(key, (userBlocks.get(key) ?? 0) + 1);
  }
  const topUsers = [...userBlocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // 마스킹 발생 집계
  const maskCount = new Map<string, number>();
  for (const l of passed) for (const t of l.maskedTypes ?? []) maskCount.set(t, (maskCount.get(t) ?? 0) + 1);

  const avgLatency = total === 0 ? 0 : Math.round(logs.reduce((s, l) => s + (l.latencyMs ?? 0), 0) / total);

  const sortMap = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  const lines: string[] = [];
  lines.push(`# AI 감사 로그 일일 리포트 — ${label}`);
  lines.push("");
  lines.push(`- 집계 구간: ${start.toISOString()} ~ ${end.toISOString()}`);
  lines.push(`- 총 요청: **${total}건**  |  정상 ${passed.length}건  |  차단 **${blocked.length}건** (${pct(blocked.length, total)})`);
  lines.push(`- 평균 처리시간: ${avgLatency}ms`);
  lines.push("");

  lines.push("## 차단 사유(룰)별 분포");
  if (ruleCount.size === 0) lines.push("- 차단 없음");
  else for (const [rule, n] of sortMap(ruleCount)) lines.push(`- \`${rule}\`: ${n}건 (${pct(n, blocked.length)})`);
  lines.push("");

  lines.push("## 패널별 요청 분포");
  for (const [panel, n] of sortMap(panelCount)) lines.push(`- ${panel}: ${n}건`);
  lines.push("");

  lines.push("## 사용자/IP별 차단 Top 10 (의심행위)");
  if (topUsers.length === 0) lines.push("- 해당 없음");
  else for (const [u, n] of topUsers) lines.push(`- ${u}: ${n}건`);
  lines.push("");

  lines.push("## 출력 마스킹 발생(정상 응답 중 PII/시크릿 치환)");
  if (maskCount.size === 0) lines.push("- 마스킹 없음");
  else for (const [t, n] of sortMap(maskCount)) lines.push(`- ${t}: ${n}건`);
  lines.push("");

  // 경보 임계치 — 차단율 20% 초과 또는 단일 사용자 10건 이상 차단
  const alerts: string[] = [];
  if (total > 0 && blocked.length / total > 0.2) alerts.push(`차단율 ${pct(blocked.length, total)} — 임계치(20%) 초과`);
  for (const [u, n] of topUsers) if (n >= 10) alerts.push(`사용자/IP ${u} 차단 ${n}건 — 집중 점검 필요`);
  lines.push("## ⚠ 경보");
  lines.push(alerts.length === 0 ? "- 임계치 초과 없음" : alerts.map((a) => `- ${a}`).join("\n"));
  lines.push("");
  lines.push(`_생성: ${new Date().toISOString()} · log_analyzer_`);

  await mkdir(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, `audit-${label}.md`);
  await writeFile(outPath, lines.join("\n"), "utf8");

  console.log(`리포트 생성: ${outPath} (총 ${total}건, 차단 ${blocked.length}건)`);
  if (alerts.length > 0) console.warn(`⚠ 경보 ${alerts.length}건 — ${outPath} 확인`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("리포트 생성 실패:", e);
  process.exit(1);
});
