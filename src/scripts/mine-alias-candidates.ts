/**
 * 별칭 후보 마이닝 — KnowledgeQueryLog에서 '재회수(정규화 질의)로 vecTop이 오른 질의쌍'을 추출해
 * regulation_aliases 등록 후보를 만든다(자동 등록 아님 — 관리자 검토·승인용 목록).
 *   npx tsx src/scripts/mine-alias-candidates.ts [--days 14] [--out backups/alias-candidates.json]
 * 함께 출력: 연성밴드 빈발 질의 상위(별칭·용어 갭의 원천 신호).
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { KnowledgeQueryLogModel } from "@/models/KnowledgeQueryLog";

function argOf(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  await connectDb();
  const days = parseInt(argOf("days", "14"), 10);
  const out = argOf("out", "backups/alias-candidates.json");
  const since = new Date(Date.now() - days * 86_400_000);

  type Row = {
    q: string; mode: string; path: string; createdAt: Date;
    signals?: { vecTop?: number | null; strongHits?: number };
    retry?: { attempted?: boolean; adopted?: boolean; normalizedQ?: string; vecTopBefore?: number | null; vecTopAfter?: number | null };
  };
  const rows = (await KnowledgeQueryLogModel.find({ createdAt: { $gte: since } })
    .select({ q: 1, mode: 1, path: 1, signals: 1, retry: 1, createdAt: 1 })
    .lean()) as unknown as Row[];

  // ① 채택된 재회수 질의쌍 → 별칭 후보(원질의 표현 ↔ 정규화 표현)
  const adopted = rows.filter((r) => r.retry?.adopted && r.retry?.normalizedQ);
  const pairKey = (r: Row) => `${r.q.trim()}→${r.retry!.normalizedQ!.trim()}`;
  const pairs = new Map<string, { q: string; normalizedQ: string; n: number; gain: number }>();
  for (const r of adopted) {
    const k = pairKey(r);
    const cur = pairs.get(k) ?? { q: r.q.trim(), normalizedQ: r.retry!.normalizedQ!.trim(), n: 0, gain: 0 };
    cur.n++;
    cur.gain += Math.max(0, (r.retry!.vecTopAfter ?? 0) - (r.retry!.vecTopBefore ?? 0));
    pairs.set(k, cur);
  }
  const candidates = [...pairs.values()]
    .map((p) => ({ ...p, avgGain: Math.round((p.gain / p.n) * 1000) / 1000 }))
    .sort((a, b) => b.n - a.n || b.avgGain - a.avgGain);

  // ② 연성밴드 빈발 질의(재회수로도 해소 안 된 것 포함) — 용어 갭 원천
  const banded = rows.filter((r) => r.path === "llm" && r.signals?.vecTop != null && r.signals.vecTop < 0.6);
  const byQ = new Map<string, number>();
  for (const r of banded) byQ.set(r.q.trim(), (byQ.get(r.q.trim()) ?? 0) + 1);
  const frequentBand = [...byQ.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([q, n]) => ({ q, n }));

  const report = {
    generatedAt: new Date().toISOString(), days,
    totals: { logs: rows.length, retryAttempted: rows.filter((r) => r.retry?.attempted).length, retryAdopted: adopted.length },
    aliasCandidates: candidates,
    frequentLowConfidence: frequentBand,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`로그 ${rows.length}건(${days}일) → 별칭 후보 ${candidates.length}쌍, 연성밴드 빈발 ${frequentBand.length}건 → ${out}`);
  for (const c of candidates.slice(0, 10)) console.log(`  [${c.n}회, +${c.avgGain}] ${c.q} → ${c.normalizedQ}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
