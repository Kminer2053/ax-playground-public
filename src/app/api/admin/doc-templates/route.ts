import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isAdmin } from "@/lib/adminAuth";
import { resolvePythonBin } from "@/lib/pythonBin";

export const dynamic = "force-dynamic";

const pExecFile = promisify(execFile);
const HWPX_DIR = path.join(process.cwd(), "tools", "hwpx");
const TPL_DIR = path.join(HWPX_DIR, "templates");
const SCRIPTS_DIR = path.join(HWPX_DIR, "scripts");
const PYTHON_BIN = resolvePythonBin();
const PY_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

/** 표준서식 hwpx를 관리자가 관리하는 양식. skeleton=true면 업로드 시 빈 골격 자동 생성,
 *  보도자료는 전용 빌더(머리표 치환)라 표준 hwpx만 교체(골격 미생성). */
export const DOC_TEMPLATE_FORMATS = [
  { key: "1p", dir: "format_1p", label: "1페이지 보고서", skeleton: true },
  { key: "full", dir: "format_full", label: "풀버전 보고서", skeleton: true },
  { key: "gongmun", dir: "format_gongmun", label: "시행문", skeleton: true },
  { key: "press", dir: "format_press", label: "보도자료", skeleton: false },
] as const;

async function slotCount(dir: string): Promise<number | null> {
  try {
    const m = JSON.parse(await readFile(path.join(TPL_DIR, dir, "skeleton_mapping.json"), "utf-8"));
    return m.total_slots ?? (Array.isArray(m.slots) ? m.slots.length : null);
  } catch {
    return null;
  }
}

/** GET /api/admin/doc-templates — 양식별 표준파일 현황. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await Promise.all(
    DOC_TEMPLATE_FORMATS.map(async (f) => {
      let size = 0;
      let mtime: string | null = null;
      try {
        const s = await stat(path.join(TPL_DIR, f.dir, "standard.hwpx"));
        size = s.size;
        mtime = s.mtime.toISOString();
      } catch {
        /* 표준 없음 */
      }
      return { format: f.key, label: f.label, hasStandard: size > 0, size, mtime, slots: await slotCount(f.dir) };
    }),
  );
  return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/admin/doc-templates (multipart: format, file) — 표준 hwpx 교체 + 빈 골격 자동 생성. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }
  const format = String(form.get("format") ?? "");
  const file = form.get("file");
  const fmt = DOC_TEMPLATE_FORMATS.find((f) => f.key === format);
  if (!fmt) return NextResponse.json({ error: "양식은 1p·full·gongmun 중 하나여야 합니다." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "표준 hwpx 파일을 첨부하세요." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".hwpx")) return NextResponse.json({ error: "hwpx 파일만 업로드할 수 있습니다." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "파일이 너무 큽니다(10MB 이내)." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  // hwpx = zip 컨테이너. PK 매직바이트로 1차 검증.
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return NextResponse.json({ error: "유효한 hwpx(zip) 파일이 아닙니다." }, { status: 400 });
  }

  const stdPath = path.join(TPL_DIR, fmt.dir, "standard.hwpx");
  await writeFile(stdPath, buf);

  // skeleton 양식만 빈 골격 자동 생성. 보도자료는 전용 빌더가 standard.hwpx를 직접 사용.
  if (fmt.skeleton) {
    try {
      await pExecFile(PYTHON_BIN, [path.join(SCRIPTS_DIR, "make_skeleton.py"), stdPath], {
        timeout: 40_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
        env: PY_ENV,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `빈 골격 생성에 실패했습니다: ${msg.slice(0, 160)}` }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, format, slots: await slotCount(fmt.dir) }, { headers: { "Cache-Control": "no-store" } });
}
