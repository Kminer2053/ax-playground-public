/**
 * /api/admin/ops — 관리자 설정 탭의 서버 운영(배포·재시작) 실행.
 *
 * POST { action: "deploy" | "restart" } — 서버의 셸 스크립트를 백그라운드로 실행.
 *  - deploy.sh 는 대화형 확인(read -p)이 있어 `echo y |` 로 승인을 주입한다(확인은 UI confirm에서 수행).
 *  - 스크립트가 pm2 restart 로 앱 자신을 재시작해도 죽지 않도록 nohup + `&` 로
 *    즉시 분리(부모 bash 가 종료되며 init 에 재부모화 → pm2 treekill 영향 없음).
 *  - 출력은 로그 파일에 기록하고, 마커 파일(last-op.json)로 진행 상태를 추적한다.
 * GET — 마지막 실행 정보(실행 중 여부 포함)와 로그 tail 반환. UI가 폴링한다.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = {
  deploy: {
    label: "소스 반영(배포)",
    script: process.env.OPS_DEPLOY_SCRIPT || "/opt/ax-playground/deploy.sh",
    command: (script: string) => `echo y | bash "${script}"`,
  },
  restart: {
    label: "서버 재시작",
    script: process.env.OPS_RESTART_SCRIPT || "/opt/ax-playground/restart.sh",
    command: (script: string) => `bash "${script}"`,
  },
} as const;

const BodySchema = z.object({ action: z.enum(["deploy", "restart"]) });

const OPS_DIR = path.resolve(process.cwd(), "logs", "ops");
const MARKER_FILE = path.join(OPS_DIR, "last-op.json");
const LOG_TAIL_BYTES = 16 * 1024;

type Marker = {
  action: keyof typeof ACTIONS;
  label: string;
  pid: number;
  logFile: string;
  startedAt: string;
};

function readMarker(): Marker | null {
  try {
    return JSON.parse(fs.readFileSync(MARKER_FILE, "utf8")) as Marker;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLogTail(logFile: string): string {
  try {
    const { size } = fs.statSync(logFile);
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const fd = fs.openSync(logFile, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return (start > 0 ? "…(앞부분 생략)\n" : "") + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/** nohup 백그라운드로 스크립트를 띄우고 PID를 반환. 부모 bash는 즉시 종료된다. */
function spawnDetached(command: string, logFile: string): Promise<number> {
  const line = `nohup bash -c '${command}' >> "${logFile}" 2>&1 & echo $!`;
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", line], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.on("error", reject);
    child.on("close", () => {
      const pid = Number.parseInt(out.trim(), 10);
      if (Number.isFinite(pid) && pid > 0) resolve(pid);
      else reject(new Error("백그라운드 프로세스 PID를 확인하지 못했습니다."));
    });
  });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (process.platform !== "linux") {
    return NextResponse.json({ ok: false, error: "이 기능은 리눅스 배포 서버에서만 사용할 수 있습니다." }, { status: 400 });
  }

  let action: keyof typeof ACTIONS;
  try {
    action = BodySchema.parse(await req.json()).action;
  } catch {
    return NextResponse.json({ ok: false, error: "action은 deploy 또는 restart여야 합니다." }, { status: 400 });
  }

  const def = ACTIONS[action];
  if (!fs.existsSync(def.script)) {
    return NextResponse.json({ ok: false, error: `스크립트가 없습니다: ${def.script}` }, { status: 400 });
  }

  const prev = readMarker();
  if (prev && pidAlive(prev.pid)) {
    return NextResponse.json({ ok: false, error: `이미 실행 중입니다: ${prev.label} (${prev.startedAt})` }, { status: 409 });
  }

  try {
    fs.mkdirSync(OPS_DIR, { recursive: true });
    const startedAt = new Date();
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(OPS_DIR, `${action}-${stamp}.log`);
    fs.writeFileSync(logFile, `=== ${def.label} 시작: ${startedAt.toISOString()} ===\n`);

    const pid = await spawnDetached(def.command(def.script), logFile);
    const marker: Marker = { action, label: def.label, pid, logFile, startedAt: startedAt.toISOString() };
    fs.writeFileSync(MARKER_FILE, JSON.stringify(marker));

    return NextResponse.json({ ok: true, op: { ...marker, running: true } }, { status: 202 });
  } catch (error) {
    console.error("[admin/ops] 실행 실패:", error);
    return NextResponse.json({ ok: false, error: "스크립트 실행에 실패했습니다. 서버 로그를 확인하세요." }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const marker = readMarker();
  if (!marker) return NextResponse.json({ ok: true, op: null, log: "" });
  return NextResponse.json({
    ok: true,
    op: { ...marker, running: pidAlive(marker.pid) },
    log: readLogTail(marker.logFile),
  });
}
