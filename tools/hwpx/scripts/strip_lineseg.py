#!/usr/bin/env python3
"""kordoc patch 결과의 줄 위치 캐시(hp:lineSegArray)를 제거한다.

patch 는 hp:t 텍스트만 교체하고 linesegarray(글자 위치/너비 캐시)는 원본대로 두므로,
교체 텍스트 길이가 원본과 달라지면 한글이 '캐시 ↔ 실제 텍스트' 불일치를 변조로 감지해
"문서가 손상되었거나 변조되었을 가능성" 경고를 띄우고 문서를 열지 않는다.
캐시를 지우면 한글이 폰트 메트릭으로 줄 나눔을 재계산한다(press_builder 와 동일 패턴).

⚠️ mimetype 은 반드시 첫 엔트리 + STORED(무압축) 로 유지해야 한글이 hwpx 로 인식한다.
"""
import re
import sys
import zipfile


def strip(path: str) -> int:
    zin = zipfile.ZipFile(path)
    data = {n: zin.read(n) for n in zin.namelist()}
    zin.close()

    removed = 0
    for name in list(data):
        if re.match(r"Contents/section\d+\.xml$", name):
            xml = data[name].decode("utf-8")
            removed += len(re.findall(r"<hp:lineSegArray>", xml, re.I))
            xml = re.sub(r"<hp:lineSegArray>.*?</hp:lineSegArray>", "", xml, flags=re.S | re.I)
            data[name] = xml.encode("utf-8")

    zout = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    zout.writestr(zipfile.ZipInfo("mimetype"), data["mimetype"], compress_type=zipfile.ZIP_STORED)
    for name, blob in data.items():
        if name != "mimetype":
            zout.writestr(name, blob)
    zout.close()
    return removed


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: strip_lineseg.py <file.hwpx>", file=sys.stderr)
        sys.exit(2)
    count = strip(sys.argv[1])
    print(f"[strip_lineseg] removed {count} lineSegArray")
