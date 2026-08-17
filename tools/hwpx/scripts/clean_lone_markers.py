#!/usr/bin/env python3
"""
clean_lone_markers.py — 1p 보고서 빈 마커 단락 정리 (P6 후처리)

fill_skeleton의 빈 슬롯 제거(remove_empty_marker_paragraphs)는 BODY_PLACEHOLDERS(공문)
한정이고, 1p 양식의 미사용 ◦/-/* 슬롯은 placeholder 앞 마커 텍스트나 normalize가 붙인
◦ 가 단독으로 남는다. 이 후처리는 표(hp:tbl) 밖의 최상위 단락 중 텍스트가 단독 마커
(◦·*·-·○·※ 등 1~2글자)뿐인 빈 단락을 제거한다. 채워진 □/◦ 단락은 텍스트가 있어 보존된다.

사용: python3 clean_lone_markers.py <hwpx>
"""
from __future__ import annotations

import os
import re
import sys
import zipfile

MARKERS = set("□◦○●-*※•·∙–−▢")


def is_lone_marker(text: str) -> bool:
    t = "".join(text.split())
    return 0 < len(t) <= 2 and all(c in MARKERS for c in t)


def collect_top_paras(xml: str) -> list[tuple[int, int]]:
    """표(hp:tbl) 밖의 최상위 hp:p 범위만 균형 매칭으로 수집."""
    tbls = [(m.start(), m.end()) for m in re.finditer(r"<hp:tbl.*?</hp:tbl>", xml, re.S)]

    def in_tbl(pos: int) -> bool:
        return any(s <= pos < e for s, e in tbls)

    out: list[tuple[int, int]] = []
    i = 0
    p_open = re.compile(r"<hp:p\b[^>]*>")
    p_any = re.compile(r"<hp:p\b[^>]*>|</hp:p>")
    while True:
        m = p_open.search(xml, i)
        if not m:
            break
        start = m.start()
        if in_tbl(start):
            i = start + 1
            continue
        depth = 0
        end = None
        for mm in p_any.finditer(xml, start):
            depth += -1 if mm.group(0).startswith("</") else 1
            if depth == 0:
                end = mm.end()
                break
        if end is None:
            break
        out.append((start, end))
        i = end
    return out


def clean(path: str) -> int:
    zin = zipfile.ZipFile(path)
    xml = zin.read("Contents/section0.xml").decode("utf-8")

    remove: list[tuple[int, int]] = []
    for s, e in collect_top_paras(xml):
        seg = xml[s:e]
        if "<hp:tbl" in seg:
            continue
        text = "".join(re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", seg))
        if is_lone_marker(text):
            remove.append((s, e))

    for s, e in sorted(remove, key=lambda x: -x[0]):
        xml = xml[:s] + xml[e:]

    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w") as zo:
        for item in zin.infolist():
            data = xml.encode("utf-8") if item.filename == "Contents/section0.xml" else zin.read(item.filename)
            ct = zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED
            zo.writestr(item, data, compress_type=ct)
    zin.close()
    os.replace(tmp, path)
    return len(remove)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("사용법: python3 clean_lone_markers.py <hwpx>", file=sys.stderr)
        sys.exit(2)
    n = clean(sys.argv[1])
    print(f"[clean_lone_markers] 빈 마커 단락 {n}개 제거")
