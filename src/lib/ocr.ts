// 광고 도안 OCR — RapidOCR로 정확한 문구 + 위치 박스를 뽑아 멀티모달 모델을 보완.
// dev·운영 모두 같은 엔진(RapidOCR)을 써서 결과가 일치한다. 무저장: 임시파일 즉시 삭제. 폐쇄망: 로컬 only.
// 프로바이더(환경변수로 전환 — 배포 방식 무관):
//   python = PYTHON_BIN으로 OCR 스크립트(기본 · dev/운영 공통) | http = OCR 사이드카 | none = 끄기
// dev 셋업: tools/ocr/setup-dev-venv.sh → tools/ocr/.venv (기본 PYTHON_BIN). 운영은 PYTHON_BIN/OCR_URL을 env로 지정.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePythonBin } from "@/lib/pythonBin";
import { execFileLimited as pExecFile } from "@/lib/subprocess";

/** box: 정규화(0~1), 원점 좌상단. */
export type OcrLine = { text: string; box: { x: number; y: number; w: number; h: number } };
export type OcrResult = { lines: OcrLine[]; text: string };

const PROVIDER = (process.env.OCR_PROVIDER ?? "python").toLowerCase();
const PYTHON_BIN = resolvePythonBin();
const OCR_SCRIPT = process.env.OCR_SCRIPT ?? path.join(process.cwd(), "tools", "ocr", "ocr_rapidocr.py");
const OCR_URL = process.env.OCR_URL ?? "http://127.0.0.1:8091/ocr";
const TIMEOUT_MS = 30_000;
const EMPTY: OcrResult = { lines: [], text: "" };

/** 이미지 바이트 → OCR 텍스트/박스. 미지원·실패 시 빈 결과(모델 단독 진행) — graceful. */
export async function ocrImage(buf: Buffer, mediaType = "image/png"): Promise<OcrResult> {
  try {
    switch (PROVIDER) {
      case "python": return await ocrPython(buf, mediaType);
      case "http": return await ocrHttp(buf, mediaType);
      default: return EMPTY; // "none" 또는 미지정
    }
  } catch {
    return EMPTY; // OCR 실패가 심의 자체를 막지 않도록
  }
}

const extOf = (mediaType: string) => (mediaType.includes("png") ? "png" : mediaType.includes("webp") ? "webp" : "jpg");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 프로바이더 공통 JSON 정규화 — {lines:[{text, box:{x,y,w,h}}]}(좌상단 정규화) 기대. */
function fromJson(raw: string): OcrResult {
  try {
    const j = JSON.parse(raw) as { lines?: Array<{ text?: unknown; box?: Record<string, unknown> }> };
    const lines: OcrLine[] = (Array.isArray(j.lines) ? j.lines : [])
      .map((l) => ({
        text: String(l.text ?? "").trim(),
        box: { x: clamp01(num(l.box?.x)), y: clamp01(num(l.box?.y)), w: clamp01(num(l.box?.w)), h: clamp01(num(l.box?.h)) },
      }))
      .filter((l) => l.text.length > 0);
    return { lines, text: lines.map((l) => l.text).join("\n") };
  } catch {
    return EMPTY;
  }
}

// python: PYTHON_BIN으로 OCR 스크립트 실행(RapidOCR). 스크립트는 위 JSON을 stdout으로 출력.
async function ocrPython(buf: Buffer, mediaType: string): Promise<OcrResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "axocr-"));
  const img = path.join(dir, `i.${extOf(mediaType)}`);
  try {
    await writeFile(img, buf);
    const { stdout } = await pExecFile(PYTHON_BIN, [OCR_SCRIPT, img], {
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    // RapidOCR 로그가 stdout에 섞일 수 있어 JSON 줄만 추출
    const jsonLine = stdout.trim().split("\n").find((line) => line.startsWith("{")) ?? stdout;
    return fromJson(jsonLine);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// http: OCR 사이드카(컨테이너)에 이미지 POST → 위 JSON 응답.
async function ocrHttp(buf: Buffer, mediaType: string): Promise<OcrResult> {
  const res = await fetch(OCR_URL, {
    method: "POST",
    headers: { "Content-Type": mediaType },
    body: new Blob([new Uint8Array(buf)]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return EMPTY;
  return fromJson(await res.text());
}
