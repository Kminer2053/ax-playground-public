#!/usr/bin/env python3
"""
press_builder.py — 보도자료(format_press) 빌더
────────────────────────────────────────────────────────────
표준 hwpx(templates/format_press/standard.hwpx — 공개판은 담당자·로고를 더미로
치환한 익명 양식)의 서식(머리표 표·글꼴·charPr·문단속성)을 통째로 보존하고
**텍스트만 치환**하는 Base-hwpx 방식.

표준 hwpx 구조(분석 결과):
  - 최상위 문단[0] = 머리표 표(보도자료 표제 + 배포일시/매수/배포부서/담당자/
    담당부서/보도일시 메타행 + 제목행 + 부제 2문단) — 라벨 앵커로 값 run만 치환
  - 문단[2..] = □/○ 본문 문단과 빈 스페이서 교대 — 첫 □/○/스페이서를
    스타일 템플릿으로 복제(charPr·paraPr 보존, 텍스트 교체)
  - 말미 = 사진 표 2개 + ▲캡션 — photoCaptions 없으면 통째 제거

입력 JSON(payload):
{
  "title": str,                       # 제목 1줄
  "subtitles": [str](1..2),           # 부제(대시 제외 본문만)
  "releaseDate": "2026. 6. 13.(토)"?, # 생략 시 오늘(KST)
  "deptPr": str?,                     # 배포부서 (미지정 시 템플릿 기본값 유지)
  "deptBiz": str,                     # 담당부서 (현업부서, LLM 생성)
  "contacts": [{"name":"홍길동 과장","phone":"02-000-0000"}]?,  # 생략 시 템플릿 유지
  "embargo": str?,                    # 기본 "바로 보도해 주시기 바랍니다."
  "body": [{"level":"□"|"○","text":str}, ...],   # □ 4~7개 권장
  "quote": {"speaker":"○○○ 대표", "part1":str, "part2":str},
  "photoCaptions": [str]?             # ▲ 제외 본문만. 없으면 사진 블록 제거
}

사용:
  python3 press_builder.py payload.json output.hwpx [--template path]
출력: JSON {status, output_path, boxes, pages, validation}
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DEFAULT_TEMPLATE = SCRIPT_DIR.parent / "templates" / "format_press" / "standard.hwpx"

WEEKDAYS = "월화수목금토일"


def xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def today_kr() -> str:
    """KST 오늘 → '2026. 6. 13.(토)'"""
    now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    return f"{now.year}. {now.month}. {now.day}.({WEEKDAYS[now.weekday()]})"


def josa_eun_neun(word: str) -> str:
    """은/는 — 마지막 한글 음절 받침 유무."""
    ch = word.strip()[-1] if word.strip() else ""
    if "가" <= ch <= "힣" and (ord(ch) - 0xAC00) % 28 != 0:
        return "은"
    return "는"


def curlyize(s: str) -> str:
    """직선따옴표 → 곡선따옴표 (자사 보도자료 표기 관행: "…"·'…')."""
    out, dq_open, sq_open = [], True, True
    for ch in s:
        if ch == '"':
            out.append("“" if dq_open else "”")
            dq_open = not dq_open
        elif ch == "'":
            out.append("‘" if sq_open else "’")
            sq_open = not sq_open
        else:
            out.append(ch)
    return "".join(out)


# ── hp:t run 수집 (self-closed <hp:t/> 제외, span 정확 추적) ──

def collect_truns(xml: str) -> list[dict]:
    runs = []
    for m in re.finditer(r"<hp:t\b[^>]*>", xml):
        if m.group(0).endswith("/>"):
            continue
        close = xml.find("</hp:t>", m.end())
        if close < 0:
            continue
        runs.append({"s": m.end(), "e": close, "text": xml[m.end():close]})
    return runs


def apply_edits(xml: str, edits: list[tuple[int, int, str]]) -> str:
    """(start, end, new) 목록을 뒤에서부터 적용."""
    for s, e, new in sorted(edits, key=lambda x: -x[0]):
        xml = xml[:s] + new + xml[e:]
    return xml


# ── 최상위 문단 추출 (표 내부 hp:p 스킵, 균형 매칭) ──

def collect_top_paras(xml: str) -> list[dict]:
    tbl_spans = [(m.start(), m.end()) for m in re.finditer(r"<hp:tbl.*?</hp:tbl>", xml, re.S)]

    def in_tbl(pos: int) -> bool:
        return any(s <= pos < e for s, e in tbl_spans)

    paras = []
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
            if mm.group(0).startswith("</"):
                depth -= 1
            else:
                depth += 1
            if depth == 0:
                end = mm.end()
                break
        if end is None:
            break
        text = "".join(re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", xml[start:end]))
        paras.append({"s": start, "e": end, "text": text.strip(), "xml": xml[start:end]})
        i = end
    return paras


# ── 문단 템플릿 텍스트 치환 (마커 run 보존, 첫 본문 run 교체, 나머지 본문 run 제거) ──

MARKERS = {"", "□", "○", "▲"}


def _collect_run_blocks(p_xml: str) -> list[dict]:
    """문단 XML 내 <hp:run ...>...</hp:run> / <hp:run .../> 블록."""
    blocks = []
    for m in re.finditer(r"<hp:run\b[^>]*>", p_xml):
        tag = m.group(0)
        if tag.endswith("/>"):
            blocks.append({"s": m.start(), "e": m.end(), "self": True, "texts": []})
            continue
        close = p_xml.find("</hp:run>", m.end())
        if close < 0:
            continue
        body = p_xml[m.end():close]
        texts = re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", body)
        blocks.append({"s": m.start(), "e": close + len("</hp:run>"), "self": False, "texts": texts})
    return blocks


def retext_para(template_xml: str, new_text: str) -> str:
    """
    마커-전용 run(□/○/공백)은 보존, 첫 콘텐츠 run의 hp:t에 new_text 주입,
    이후 콘텐츠 run은 제거(서식 단일화). 콘텐츠 run이 없으면(스페이서) 그대로 반환.
    """
    blocks = _collect_run_blocks(template_xml)
    edits: list[tuple[int, int, str]] = []
    replaced = False
    for b in blocks:
        joined = "".join(b["texts"]).replace(" ", " ").strip()
        is_marker = joined in MARKERS
        if is_marker:
            continue
        if not replaced:
            # 이 run 내부 첫 hp:t에 new_text, 나머지 hp:t는 비움
            seg = template_xml[b["s"]:b["e"]]
            t_edits = []
            first = True
            for m in re.finditer(r"(<hp:t\b[^>]*>)([^<]*)(</hp:t>)", seg):
                t_edits.append((b["s"] + m.start(2), b["s"] + m.end(2),
                                xml_escape(new_text) if first else ""))
                first = False
            edits.extend(t_edits)
            replaced = True
        else:
            edits.append((b["s"], b["e"], ""))  # 잉여 콘텐츠 run 제거
    return apply_edits(template_xml, edits)


# ── 메인 빌드 ──

def build(payload: dict, output_path: str, template: str | None = None) -> dict:
    tpl_path = Path(template) if template else DEFAULT_TEMPLATE
    if not tpl_path.exists():
        return {"status": "error", "stage": "template", "error": f"템플릿 없음: {tpl_path}"}

    zin = zipfile.ZipFile(tpl_path)
    xml = zin.read("Contents/section0.xml").decode("utf-8")

    body_items = payload.get("body") or []
    quote = payload.get("quote") or {}
    subtitles = [s for s in (payload.get("subtitles") or []) if s and s.strip()][:2]
    captions = [c for c in (payload.get("photoCaptions") or []) if c and c.strip()]
    box_count = sum(1 for b in body_items if b.get("level") == "□")
    # 매수 추정 (분석 문서 §3): □ 4 이하=2매, 5~6=3매, 7+=4매
    pages = 2 if box_count <= 4 else (3 if box_count <= 6 else 4)

    # ── 1) 머리표·제목·부제: 라벨 앵커 run 치환 ──
    runs = collect_truns(xml)

    def find_label(label: str) -> int:
        target = label.replace(" ", "")
        for i, r in enumerate(runs):
            if r["text"].replace(" ", " ").replace(" ", "") == target:
                return i
        raise KeyError(f"라벨 미발견: {label}")

    edits: list[tuple[int, int, str]] = []

    def set_run(idx: int, text: str):
        r = runs[idx]
        edits.append((r["s"], r["e"], xml_escape(text)))

    set_run(find_label("배포일시") + 2, payload.get("releaseDate") or today_kr())
    set_run(find_label("매수") + 2, f"총 {pages}매")
    if payload.get("deptPr"):
        set_run(find_label("배포부서") + 2, payload["deptPr"])
    contacts = payload.get("contacts") or []
    if contacts:
        ci = find_label("담당자")
        c0 = contacts[0]
        set_run(ci + 2, f"{c0.get('name', '')} ")
        set_run(ci + 3, f"({c0.get('phone', '')})")
        if len(contacts) >= 2:
            set_run(ci + 4, f"{contacts[1].get('name', '')} ")
            set_run(ci + 5, f"({contacts[1].get('phone', '')})")
        else:
            set_run(ci + 4, "")
            set_run(ci + 5, "")
    if payload.get("deptBiz"):
        set_run(find_label("담당부서") + 2, payload["deptBiz"])
    emb_i = find_label("보도일시") + 2
    set_run(emb_i, payload.get("embargo") or "바로 보도해 주시기 바랍니다.")
    # 제목·부제: 보도일시 값 다음 run들 (구조 고정: 제목 / "- " / 부제1 / 부제2)
    set_run(emb_i + 1, curlyize(payload.get("title") or ""))
    sub1 = curlyize((subtitles[0] if subtitles else "").lstrip("- ").strip())
    sub2 = curlyize((subtitles[1] if len(subtitles) > 1 else "").lstrip("- ").strip())
    set_run(emb_i + 3, sub1)
    set_run(emb_i + 4, sub2)

    xml = apply_edits(xml, edits)

    # ── 2) 본문 리빌드: 템플릿 문단 복제 ──
    paras = collect_top_paras(xml)
    box_tpl = circ_tpl = spacer_tpl = capt_tpl = None
    body_start_idx = None
    for i, p in enumerate(paras):
        t = p["text"]
        if box_tpl is None and t.startswith("□"):
            box_tpl, body_start_idx = p["xml"], i
        if circ_tpl is None and t.startswith("○"):
            circ_tpl = p["xml"]
        if box_tpl is not None and spacer_tpl is None and t == "" and "<hp:tbl" not in p["xml"]:
            spacer_tpl = p["xml"]
        if t.startswith("▲") and "<hp:tbl" not in p["xml"]:
            capt_tpl = p["xml"]
    if not (box_tpl and circ_tpl and spacer_tpl and body_start_idx is not None):
        return {"status": "error", "stage": "template-scan",
                "error": "표준 hwpx에서 □/○/스페이서 템플릿 문단을 찾지 못함"}

    parts: list[str] = []
    for item in body_items:
        tpl = box_tpl if item.get("level") == "□" else circ_tpl
        parts.append(retext_para(tpl, curlyize(str(item.get("text", "")).strip())))
        parts.append(spacer_tpl)
    if quote.get("speaker") and quote.get("part1"):
        sp = str(quote["speaker"]).strip()
        q = f"{sp}{josa_eun_neun(sp)} “{str(quote['part1']).strip().strip('\"“”')}”며, “{str(quote.get('part2', '')).strip().strip('\"“”')}”고 말했다."
        parts.append(retext_para(box_tpl, q))
    if captions and capt_tpl:
        parts.append(spacer_tpl)
        for c in captions:
            parts.append(retext_para(capt_tpl, f"▲ {c.strip()}"))

    new_xml = xml[: paras[body_start_idx]["s"]] + "".join(parts) + xml[paras[-1]["e"]:]

    # linesegarray(줄 위치 렌더 캐시) 전체 제거 — 머리표·본문 텍스트를 치환하면 원본의
    # 줄 좌표(vertpos)가 어긋나고, 문단 복제로 같은 vertpos가 중복되면 한컴이 레이아웃을
    # 잡지 못해 문서를 거부한다(실측: press만 안 열림). 한글은 linesegarray가 없으면 열 때
    # 재계산하므로 통째로 제거가 안전하다(1p/full/gongmun 빌더도 linesegarray 미포함).
    new_xml = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", new_xml, flags=re.S)

    # ── 3) zip 재조립 (mimetype STORED 우선 — Critical Rule 3) ──
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as zo:
        zo.writestr(
            zipfile.ZipInfo("mimetype"), zin.read("mimetype"),
            compress_type=zipfile.ZIP_STORED,
        )
        for item in zin.infolist():
            if item.filename in ("mimetype", "Contents/section0.xml"):
                continue
            zo.writestr(item.filename, zin.read(item.filename),
                        compress_type=zipfile.ZIP_DEFLATED)
        zo.writestr("Contents/section0.xml", new_xml.encode("utf-8"),
                    compress_type=zipfile.ZIP_DEFLATED)
    zin.close()

    # ── 4) 후처리: fix_namespaces(필수) + validate ──
    r = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "fix_namespaces.py"), str(out)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return {"status": "error", "stage": "fix_namespaces", "stderr": r.stderr}
    v = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "validate.py"), str(out)],
        capture_output=True, text=True,
    )
    return {
        "status": "ok",
        "output_path": str(out),
        "boxes": box_count,
        "pages": pages,
        "validation": v.stdout.strip(),
    }


if __name__ == "__main__":
    from stdio_utf8 import configure_stdio_utf8

    configure_stdio_utf8()
    ap = argparse.ArgumentParser(description="보도자료 hwpx 빌더 (Base-hwpx 치환)")
    ap.add_argument("payload", help="콘텐츠 JSON 경로")
    ap.add_argument("output", help="출력 .hwpx 경로")
    ap.add_argument("--template", default="", help="표준 hwpx 경로 (기본 templates/format_press/standard.hwpx)")
    args = ap.parse_args()
    data = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    result = build(data, args.output, args.template or None)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("status") == "ok" else 1)
