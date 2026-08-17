import path from "node:path";
import { existsSync } from "node:fs";

/**
 * OCR venv·HWPX 스크립트 공통 Python 실행 파일.
 * 우선순위: PYTHON_BIN env → 프로젝트 OCR venv(있을 때) → 시스템 python.
 * HWPX 스크립트는 순수 stdlib라 시스템 python으로도 동작하므로, venv가 없어도
 * 시스템 python으로 폴백한다(미설정+venv부재 시 ENOENT로 깨지지 않게).
 */
export function resolvePythonBin(): string {
  const fromEnv = process.env.PYTHON_BIN?.trim();
  if (fromEnv) return fromEnv;

  const isWin = process.platform === "win32";
  const venv = isWin
    ? path.join(process.cwd(), "tools", "ocr", ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "tools", "ocr", ".venv", "bin", "python");
  if (existsSync(venv)) return venv;

  // 폴백: 시스템 Python (HWPX 변환은 stdlib만 사용). OCR은 rapidocr 필요 — venv/PYTHON_BIN 권장.
  return isWin ? "python" : "python3";
}
