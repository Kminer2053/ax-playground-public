#!/usr/bin/env python3
"""광고 도안 OCR — RapidOCR + 한국어(PP-OCRv5).

CLI:    python ocr_rapidocr.py <image>   → JSON을 stdout으로 (Node python 프로바이더용)
import: from ocr_rapidocr import run_ocr → 엔진 1회 로드 후 재사용 (사이드카 ocr_server.py용)

출력: {"lines":[{"text":"...","box":{"x":0~1,"y":0~1,"w":0~1,"h":0~1}}]}  (정규화, 원점 좌상단)
- 무저장: 입력 이미지는 호출측이 임시파일로 넘기고 즉시 삭제.
- 폐쇄망: 모델(korean_PP-OCRv5_rec 등)은 빌드 시 사전 동봉 → 런타임 네트워크 0.
- 실패해도 항상 유효 JSON({"lines":[],"error":...}) → 호출측 graceful 폴백.
"""
import sys
import json

# Windows: stdout 기본 cp949 → Node(UTF-8)와 불일치로 한글이 깨짐. JSON만 UTF-8로 출력.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from pathlib import Path

        import rapidocr
        from rapidocr import RapidOCR, LangRec, OCRVersion

        # omegaconf 2.0 은 pathlib.Path 를 받지 못함 — Windows 에서 model_root_dir 오류 방지.
        model_root = str(Path(rapidocr.__file__).resolve().parent / "models")
        _engine = RapidOCR(params={
            "Global.model_root_dir": model_root,
            "Rec.lang_type": LangRec.KOREAN,        # 한국어 인식 모델
            "Rec.ocr_version": OCRVersion.PPOCRV5,  # 최신 PP-OCRv5
        })
    return _engine


def run_ocr(img_path: str) -> dict:
    """이미지 경로 → {"lines":[{text, box}]}. 실패 시 {"lines":[], "error":...}."""
    try:
        import numpy as np
    except Exception as e:
        return {"lines": [], "error": f"import: {e}"}
    try:
        res = _get_engine()(img_path)
    except Exception as e:
        return {"lines": [], "error": f"ocr: {e}"}

    # 박스 정규화용 이미지 크기 — Windows 한글 경로(Users\내부망\Temp 등)에서 cv2.imread 실패 방지
    w = h = 0
    try:
        import cv2
        import numpy as np

        buf = np.fromfile(img_path, dtype=np.uint8)
        im = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if im is None:
            im = cv2.imread(img_path)
        if im is not None:
            h, w = int(im.shape[0]), int(im.shape[1])
    except Exception:
        pass
    boxes = list(res.boxes) if getattr(res, "boxes", None) is not None else []
    if (not w or not h) and boxes:  # 폴백: 박스 최대 좌표로 추정
        pts = np.concatenate([np.array(b).reshape(-1, 2) for b in boxes], axis=0)
        w = w or int(pts[:, 0].max()) or 1
        h = h or int(pts[:, 1].max()) or 1
    w = w or 1
    h = h or 1

    def clamp(v):
        return max(0.0, min(1.0, v))

    lines = []
    for i, t in enumerate(list(getattr(res, "txts", None) or [])):
        t = (t or "").strip()
        if not t:
            continue
        item = {"text": t}
        if i < len(boxes):
            p = np.array(boxes[i]).reshape(-1, 2)
            x0, y0 = float(p[:, 0].min()), float(p[:, 1].min())
            x1, y1 = float(p[:, 0].max()), float(p[:, 1].max())
            item["box"] = {"x": clamp(x0 / w), "y": clamp(y0 / h),
                           "w": clamp((x1 - x0) / w), "h": clamp((y1 - y0) / h)}
        lines.append(item)
    return {"lines": lines}


def main() -> None:
    out = run_ocr(sys.argv[1]) if len(sys.argv) > 1 else {"lines": [], "error": "no image path"}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
