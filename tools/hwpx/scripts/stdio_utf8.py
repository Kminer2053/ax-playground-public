"""Windows cp949 stdout에서 한글 JSON 출력 UnicodeEncodeError 방지."""
import sys


def configure_stdio_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass
