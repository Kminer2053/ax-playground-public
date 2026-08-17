#!/usr/bin/env python3
"""광고심의 OCR 사이드카 — RapidOCR 모델을 1회 로드해 메모리에 상주(요청마다 재로드 없음).

표준 라이브러리 http.server만 사용(FastAPI/uvicorn 등 추가 의존성 0).
앱은 OCR_PROVIDER=http, OCR_URL=http://127.0.0.1:8091/ocr 로 이미지 바이트를 POST한다.
무저장: 이미지는 임시파일로만 잠깐 쓰고 즉시 삭제.

  python ocr_server.py        # 기본 포트 8091 (OCR_PORT 로 변경)
"""
import os
import json
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

from ocr_rapidocr import run_ocr


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # 헬스체크
        self._send(200, {"ok": True})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        data = self.rfile.read(n) if n else b""
        ctype = (self.headers.get("Content-Type") or "image/png").lower()
        ext = "png" if "png" in ctype else "webp" if "webp" in ctype else "jpg"
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
                f.write(data)
                path = f.name
            out = run_ocr(path)
        except Exception as e:
            out = {"lines": [], "error": f"server: {e}"}
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        self._send(200, out)

    def _send(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 무저장/소음 억제 — 접근 로그 미출력
        pass


if __name__ == "__main__":
    port = int(os.environ.get("OCR_PORT", "8091"))
    print(f"[ocr_server] RapidOCR 한국어 사이드카 — 127.0.0.1:{port} (첫 요청 시 모델 로드)")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
