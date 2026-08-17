#!/usr/bin/env python3
"""스캔(이미지) PDF → 한국어 OCR 텍스트 (RapidOCR PP-OCRv5 + PyMuPDF 래스터화).

CLI: python ocr_pdf.py <pdf> [--max-pages N] [--dpi 200]
출력: stdout(UTF-8) — 페이지마다 "<<<PAGE:N>>>" 마커 + OCR 줄(본문 파이프라인 tokenize가 페이지로 인식).

- 폐쇄망: rapidocr 모델·pymupdf 사전 동봉(런타임 네트워크 0).
- 관리자 사규 적재 API가 텍스트층 없는 PDF에서만 호출(에스컬레이션). 실패 페이지는 건너뛰고 계속.
"""
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        return
    pdf = args[0]
    max_pages = 0
    dpi = 200
    for i, a in enumerate(args):
        if a == "--max-pages" and i + 1 < len(args):
            try:
                max_pages = int(args[i + 1])
            except ValueError:
                pass
        if a == "--dpi" and i + 1 < len(args):
            try:
                dpi = int(args[i + 1])
            except ValueError:
                pass
    try:
        import numpy as np
        import fitz  # PyMuPDF
        from pathlib import Path
        import rapidocr
        from rapidocr import RapidOCR, LangRec, OCRVersion
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"import fail: {e}\n")
        return

    model_root = str(Path(rapidocr.__file__).resolve().parent / "models")
    engine = RapidOCR(params={
        "Global.model_root_dir": model_root,
        "Rec.lang_type": LangRec.KOREAN,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
    })

    try:
        doc = fitz.open(pdf)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"open fail: {e}\n")
        return

    total = doc.page_count
    n = total if max_pages <= 0 else min(total, max_pages)
    out = []
    for i in range(n):
        try:
            pix = doc[i].get_pixmap(dpi=dpi)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                img = img[:, :, :3]
            res = engine(img)
            txts = [(t or "").strip() for t in (list(getattr(res, "txts", None) or [])) if (t or "").strip()]
        except Exception:  # noqa: BLE001
            txts = []
        out.append(f"<<<PAGE:{i + 1}>>>")
        out.extend(txts)
    if max_pages > 0 and total > n:
        out.append(f"<<<PAGE:{n + 1}>>>")
        out.append(f"(미리보기 — {total}쪽 중 {n}쪽만 OCR. 적재 시 전체 처리)")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
