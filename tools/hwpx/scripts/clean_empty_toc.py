#!/usr/bin/env python3
"""풀버전 목차에서 '빈 목차 점선 단락'을 제거한다.

목차 슬롯(52개)이 실제 장·절 수보다 많으면, 미사용 목차 항목이
"공백 + 점선(<hp:tab leader=…>) + EMPTY 제목/페이지" 단락으로 남아
…N 형태의 빈 점선 줄이 된다. 제목 텍스트(한글/영문/로마자)가 없는
점선 단락만 골라 제거한다(정상 목차 줄은 제목이 있어 보존).

⚠️ mimetype 은 첫 엔트리 + STORED 로 유지(hwpx 인식).
"""
import re
import sys
import zipfile


def _is_empty_toc_para(p: str) -> bool:
    if "leader" not in p:  # 목차 점선 단락만 대상
        return False
    texts = "".join(re.findall(r"<hp:t>(.*?)</hp:t>", p, re.S))
    inner = re.sub(r"<[^>]+>", "", texts)  # hp:tab 등 element 제거, 텍스트만
    # 제목 텍스트(한글/영문/로마자)가 있으면 정상 목차 줄 → 보존
    return not re.search(r"[가-힣A-Za-zⅠ-Ⅹ]", inner)


def clean(path: str) -> int:
    zin = zipfile.ZipFile(path)
    data = {n: zin.read(n) for n in zin.namelist()}
    zin.close()

    xml = data["Contents/section0.xml"].decode("utf-8")
    removed = 0
    # 뒤에서부터 제거(인덱스 보존)
    for m in reversed(list(re.finditer(r"<hp:p\b.*?</hp:p>", xml, re.S))):
        if _is_empty_toc_para(m.group(0)):
            xml = xml[: m.start()] + xml[m.end():]
            removed += 1
    data["Contents/section0.xml"] = xml.encode("utf-8")

    zout = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    zout.writestr(zipfile.ZipInfo("mimetype"), data["mimetype"], compress_type=zipfile.ZIP_STORED)
    for name, blob in data.items():
        if name != "mimetype":
            zout.writestr(name, blob)
    zout.close()
    return removed


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: clean_empty_toc.py <file.hwpx>", file=sys.stderr)
        sys.exit(2)
    print(f"[clean_empty_toc] removed {clean(sys.argv[1])} empty TOC lines")
