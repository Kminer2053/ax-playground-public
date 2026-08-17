/**
 * 사규 원본 파일 → 텍스트 추출(에스컬레이션 루프).
 *  1) 텍스트 추출: txt/md 직접, hwp·hwpx·pdf·docx·xlsx는 kordoc(parseAttachment).
 *  2) 스캔 PDF(텍스트층 없음/한글비율 낮음) → 한국어 OCR(ocr_pdf.py)로 자동 승격.
 * 관리자 적재 API에서 사용. 폐쇄망: kordoc CLI·OCR venv 사전 동봉.
 */
import path from "node:path";
import { resolvePythonBin } from "@/lib/pythonBin";
import { execFileLimited as pExecFile } from "@/lib/subprocess";
import { parseAttachment, SUPPORTED_ATTACHMENT_EXTS } from "@/lib/docparse";

const PYTHON_BIN = resolvePythonBin();
const OCR_PDF_SCRIPT = path.join(process.cwd(), "tools", "ocr", "ocr_pdf.py");

export type ExtractMethod = "text" | "ocr" | "none";
export type ExtractResult = {
  text: string;
  method: ExtractMethod;
  chars: number;        // 비공백 글자수
  koreanRatio: number;  // 한글/비공백
  ext: string;
  note?: string;        // 안내(스캔 OCR 적용·추출 경고 등)
};

const nz = (s: string) => s.replace(/\s/g, "").length;
const koreanRatio = (s: string) => { const ko = (s.match(/[가-힣]/g) || []).length; const t = nz(s); return t ? ko / t : 0; };

/** 스캔(이미지) PDF 판정 — 텍스트층이 거의 없거나 한글비율이 비정상적으로 낮음. 문서작성 첨부의 'OCR로 읽을까요?' 안내에도 재사용. */
export function isLikelyScannedPdf(ext: string, extractedText: string): boolean {
  return ext.toLowerCase() === ".pdf" && (nz(extractedText) < 200 || koreanRatio(extractedText) < 0.05);
}

export { SUPPORTED_ATTACHMENT_EXTS };

/** 파일 → 텍스트. 스캔 PDF는 OCR로 자동 승격. ocrMaxPages로 미리보기 시 페이지 제한(0=전체). */
export async function extractRegulationFile(
  filePath: string,
  originalName: string,
  opts?: { ocrMaxPages?: number; allowOcr?: boolean },
): Promise<ExtractResult> {
  const ext = path.extname(originalName).toLowerCase();
  const parsed = await parseAttachment(filePath, originalName);
  let text = parsed.ok ? parsed.markdown : "";
  let method: ExtractMethod = parsed.ok && nz(text) > 0 ? "text" : "none";
  let note = parsed.ok ? undefined : parsed.error;

  // 스캔 PDF 에스컬레이션 → 한국어 OCR
  const allowOcr = opts?.allowOcr !== false;
  const looksScanned = isLikelyScannedPdf(ext, text);
  if (allowOcr && looksScanned) {
    const ocrText = await ocrPdf(filePath, opts?.ocrMaxPages);
    if (nz(ocrText) > nz(text)) {
      text = ocrText;
      method = "ocr";
      note = opts?.ocrMaxPages
        ? `스캔 PDF — 한국어 OCR(미리보기 ${opts.ocrMaxPages}쪽). 인식오차 가능.`
        : "스캔 PDF — 한국어 OCR 자동 적용. 인식오차 가능.";
    }
  }
  return { text, method, chars: nz(text), koreanRatio: koreanRatio(text), ext, note };
}

async function ocrPdf(filePath: string, maxPages?: number): Promise<string> {
  try {
    const a = [OCR_PDF_SCRIPT, filePath];
    if (maxPages && maxPages > 0) a.push("--max-pages", String(maxPages));
    const { stdout } = await pExecFile(PYTHON_BIN, a, {
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    return stdout || "";
  } catch {
    return "";
  }
}
