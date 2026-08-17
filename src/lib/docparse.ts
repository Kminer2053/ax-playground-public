import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileLimited as pExecFile } from "@/lib/subprocess";

/**
 * 업로드 컨텍스트 파일 파싱 (P6) — kordoc(npm) 기반.
 *
 * kordoc CLI(node_modules/kordoc/dist/cli.js)를 자식 프로세스로 호출해 HWP/HWPX/PDF/
 * DOCX/XLSX를 마크다운으로 추출한다. 의존성은 전부 순수 JS(@xmldom/xmldom·cfb·jszip·
 * pdfjs-dist v5)라 폐쇄망에서도 npm 설치만으로 동작(native 빌드 불요).
 * txt/md는 kordoc 대상이 아니므로 직접 읽는다.
 */

const KORDOC_CLI = path.join(process.cwd(), "node_modules", "kordoc", "dist", "cli.js");

const KORDOC_EXTS = new Set([".hwp", ".hwpx", ".pdf", ".docx", ".xlsx"]);
const TEXT_EXTS = new Set([".txt", ".md", ".markdown"]);

/** UI에 안내할 지원 확장자(첨부 input accept). */
export const SUPPORTED_ATTACHMENT_EXTS = [".txt", ".md", ".hwp", ".hwpx", ".pdf", ".docx", ".xlsx"];

export type ParsedAttachment = {
  name: string;
  format: string;
  ok: boolean;
  chars: number;
  /** 추출된 마크다운 텍스트(성공 시). */
  markdown: string;
  error?: string;
};

/**
 * 한 파일을 파싱해 마크다운을 반환. 실패해도 throw하지 않고 ok:false로 담아
 * 다른 첨부 처리가 끊기지 않게 한다(미리보기/생성 양쪽에서 재사용).
 */
export async function parseAttachment(filePath: string, originalName: string): Promise<ParsedAttachment> {
  const ext = path.extname(originalName).toLowerCase();
  const base: ParsedAttachment = {
    name: originalName,
    format: ext.replace(".", "") || "unknown",
    ok: false,
    chars: 0,
    markdown: "",
  };
  try {
    if (TEXT_EXTS.has(ext)) {
      const txt = await readFile(filePath, "utf-8");
      return { ...base, ok: true, chars: txt.length, markdown: txt };
    }
    if (KORDOC_EXTS.has(ext)) {
      const { stdout } = await pExecFile(
        process.execPath,
        [KORDOC_CLI, filePath, "--format", "markdown", "--silent"],
        { timeout: 40_000, maxBuffer: 48 * 1024 * 1024 },
      );
      const md = stdout.trim();
      if (!md) {
        return { ...base, error: "추출된 텍스트가 없습니다(스캔 이미지 PDF는 OCR 미지원)." };
      }
      return { ...base, ok: true, chars: md.length, markdown: md };
    }
    return { ...base, error: `지원하지 않는 형식입니다(${ext || "확장자 없음"}). txt·md·hwp·hwpx·pdf·docx·xlsx만 가능합니다.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, error: msg.includes("ENOENT") ? "파서를 찾을 수 없습니다(kordoc 미설치)." : msg.slice(0, 200) };
  }
}

/** 마크다운에서 표/이미지 마크업을 걷어낸 평문 — LLM 컨텍스트·미리보기 글자수용. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/?(table|tr|td|th|thead|tbody|br)[^>]*>/gi, " ")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
