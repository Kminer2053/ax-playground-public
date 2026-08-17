"""
expand_gongmun_body.py — 공문 본문 동적 확장 + 빈 단락 제거 (v3.6.7/3.6.8)
────────────────────────────────────────────────────────────────────────
공문 양식 skeleton 의 본문 슬롯은 각 위계마다 1~2개로 고정되어 있다. 이 모듈은
사용자가 입력한 콘텐츠 양에 따라 모든 위계의 단락을 동적으로 확장하고,
콘텐츠가 없는 placeholder 는 단락 자체를 출력에서 제거한다.

## 지원 위계 (EXPANSION_RULES)

| 입력 키 | 양식 슬롯 | 동적 추가 paraPr/charPr | 들여쓰기 |
|---|---|---|---|
| 본문 | text_007 + text_008/text_009 | 29 / 24 | 없음 |
| 본문_가나 | 목차_항목_001 / 002 | 26 / 22 | 없음 |
| 본문_1) | text_010 | 26 / 27 | 4-space |
| 본문_가) | text_011 | 26 / 27 | 6-space |
| 본문_(1) | text_012 | 26 / 27 | 8-space |
| 본문_① | text_013 | 26 / 27 | 10-space |
| 붙임 | 목차_항목_003 / 004 | 27 / 22 | 없음 |

## 빈 단락 제거
values 에 없거나 빈 값인 placeholder 는 EMPTY_MARKER 로 치환되고, 후처리에서
EMPTY_MARKER 만 있는 hp:p 통째 제거 (한글에서 빈 줄로 안 보임).
"""

import re


EXPANSION_RULES = [
    {
        "key": "본문",
        "slots": ["text_007", ("text_008", "text_009")],
        "para_pr": "29", "char_pr": "24",
        "anchor": "text_009",
        "slot_indent": "",       # 양식 슬롯 텍스트 prefix
        "dynamic_indent": "",    # 동적 단락 텍스트 prefix
    },
    {
        # 본문_가나: 양식 슬롯에 이미 "  <hp:fwSpace/>" 자동 들여쓰기 → slot_indent="" 유지
        # 동적 추가에도 동일한 raw XML element 사용 (시각적으로 정확히 동일)
        "key": "본문_가나",
        "slots": ["목차_항목_001", "목차_항목_002"],
        "para_pr": "26", "char_pr": "22",
        "anchor": "목차_항목_002",
        "slot_indent": "",
        "dynamic_indent": "",
        "dynamic_indent_xml": "  <hp:fwSpace/>",  # 양식과 동일한 raw XML
    },
    {
        # 본문_1)~①: 양식 슬롯 placeholder 앞 들여쓰기 없음 → 양식 슬롯에도 prefix 적용 필요
        # 양식 원본 텍스트의 들여쓰기 폭(4/6/8/10 space)과 동일하게 통일
        "key": "본문_1)",
        "slots": ["text_010"],
        "para_pr": "26", "char_pr": "27",
        "anchor": "text_010",
        "slot_indent": "    ",
        "dynamic_indent": "    ",
    },
    {
        "key": "본문_가)",
        "slots": ["text_011"],
        "para_pr": "26", "char_pr": "27",
        "anchor": "text_011",
        "slot_indent": "      ",
        "dynamic_indent": "      ",
    },
    {
        "key": "본문_(1)",
        "slots": ["text_012"],
        "para_pr": "26", "char_pr": "27",
        "anchor": "text_012",
        "slot_indent": "        ",
        "dynamic_indent": "        ",
    },
    {
        "key": "본문_①",
        "slots": ["text_013"],
        "para_pr": "26", "char_pr": "27",
        "anchor": "text_013",
        "slot_indent": "          ",
        "dynamic_indent": "          ",
    },
    {
        # 붙임은 사용자가 텍스트 안에 들여쓰기 직접 입력 (관습)
        "key": "붙임",
        "slots": ["목차_항목_003"],
        "para_pr": "27", "char_pr": "22",
        "anchor": "목차_항목_003",
        "slot_indent": "",
        "dynamic_indent": "",
    },
]


def _split_marker(text: str) -> tuple:
    """'2. 본문' → ('2. ', '본문') 자동 분리."""
    m = re.match(r'^(\d+\.\s*)(.+)$', text, re.DOTALL)
    if m:
        return m.group(1), m.group(2)
    return "", text


def _apply_indent(text: str, indent: str) -> str:
    """텍스트가 공백(반각/전각)으로 시작하면 그대로, 아니면 indent prefix 추가."""
    if not indent:
        return text
    if text and (text[0] in (" ", "\u3000", "\t")):
        return text  # 사용자가 직접 들여쓰기 입력
    return indent + text


def normalize_body_input(values: dict, rules: list = EXPANSION_RULES) -> tuple:
    """values 위계 입력을 정규화. (new_values, dynamic_by_anchor) 반환.

    v3.6.8 변경: 양식 슬롯에 들어가는 텍스트에도 slot_indent prefix 적용,
    동적 추가에는 dynamic_indent prefix 적용 → 양식 슬롯/동적 단락 들여쓰기 통일.
    rules 로 양식별 확장 규칙을 주입 (기본: 공문 EXPANSION_RULES).
    """
    new_values = dict(values)
    dynamic = {}

    for rule in rules:
        key = rule["key"]
        if key not in new_values:
            continue
        items = new_values.pop(key)
        if not isinstance(items, list):
            continue

        slots = rule["slots"]
        slot_indent = rule.get("slot_indent", "")
        dynamic_indent = rule.get("dynamic_indent", "")
        consumed = 0
        for slot in slots:
            if consumed >= len(items):
                break
            item = items[consumed]
            # 양식 슬롯에 들어가는 텍스트도 slot_indent 적용
            item = _apply_indent(item, slot_indent)
            if isinstance(slot, tuple):
                marker, body = _split_marker(item)
                marker_token, body_token = slot
                new_values.setdefault(marker_token, marker)
                new_values.setdefault(body_token, body)
            else:
                new_values.setdefault(slot, item)
            consumed += 1

        extra_items = items[consumed:]
        if extra_items:
            anchor = rule["anchor"]
            indent_xml = rule.get("dynamic_indent_xml", "")
            dynamic.setdefault(anchor, [])
            for item in extra_items:
                text = _apply_indent(item, dynamic_indent)
                dynamic[anchor].append(
                    (text, rule["para_pr"], rule["char_pr"], indent_xml))

    return new_values, dynamic


def _build_p_block(text: str, para_pr: str, char_pr: str,
                   indent_xml: str = "") -> str:
    """동적 hp:p 단락 생성.

    indent_xml: hp:t 안에 raw XML 로 들어갈 들여쓰기 prefix. 양식의
      `<hp:fwSpace/>` 같은 element 를 그대로 사용해서 양식 슬롯과 시각적으로
      정확히 동일한 들여쓰기 효과 달성. 텍스트 prefix 와 달리 폰트 메트릭 의존
      없음.
    """
    safe = (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))
    return (
        f'<hp:p id="0" paraPrIDRef="{para_pr}" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{char_pr}">'
        f'<hp:t>{indent_xml}{safe}</hp:t>'
        f'</hp:run>'
        f'</hp:p>'
    )


def _find_matching_p_close(xml: str, p_start: int) -> int:
    """hp:p 시작 위치에서 짝 맞는 </hp:p> 끝 위치 반환 (depth 추적).
    hp:p 안에 hp:tbl > hp:tc > hp:subList > hp:p 가 중첩된 경우 대응.
    Returns -1 if not found.
    """
    depth = 1
    pos = p_start + len('<hp:p ')
    while depth > 0:
        next_open = xml.find('<hp:p ', pos)
        next_close = xml.find('</hp:p>', pos)
        if next_close == -1:
            return -1
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = next_open + len('<hp:p ')
        else:
            depth -= 1
            pos = next_close + len('</hp:p>')
            if depth == 0:
                return pos
    return -1


def insert_dynamic_paragraphs(xml: str, dynamic: dict) -> tuple:
    """anchor placeholder 가 든 hp:p 의 짝 맞는 </hp:p> 직후에 동적 단락 삽입.

    안전 원칙: hp:p 안에 hp:tbl 이 든 단락(예: 발신부 표 감싸기) 은 anchor 로
    사용하지 않는다 (EXPANSION_RULES 가 그런 anchor 를 피하도록 설계됨).
    따라서 단순 </hp:p> 다음 삽입만으로 충분 — hp:p 분리 같은 위험 로직 불필요.
    """
    n_inserted = 0
    for anchor, items in dynamic.items():
        if not items:
            continue
        token_str = "{{" + anchor + "}}"
        idx = xml.find(token_str)
        if idx == -1:
            continue
        p_start = xml.rfind('<hp:p ', 0, idx)
        if p_start == -1:
            continue
        p_end = _find_matching_p_close(xml, p_start)
        if p_end == -1:
            continue
        parts = []
        for it in items:
            if len(it) == 2 and it[0] == "__RAWBLOCK__":
                parts.append(it[1])          # 표 등 사전 완성된 raw hp:p 블록
            else:
                parts.append(_build_p_block(*it))
        dyn_blocks = "".join(parts)
        xml = xml[:p_end] + dyn_blocks + xml[p_end:]
        n_inserted += len(items)
    return xml, n_inserted


def apply_body_expansion(values: dict, xml: str, rules: list = EXPANSION_RULES) -> tuple:
    """본문 동적 확장 통합 진입점 (rules 로 양식별 규칙 주입)."""
    new_values, dynamic = normalize_body_input(values, rules)
    new_xml, n_inserted = insert_dynamic_paragraphs(xml, dynamic)
    summary = {
        "extra_paragraphs_inserted": n_inserted,
        "extra_by_anchor": {a: [item[0][:40] for item in items]
                            for a, items in dynamic.items() if items},
    }
    return new_values, new_xml, summary


# ────────────────────────────────────────────────────────────────
# 1페이지 보고서(format_1p) ◦ 항목 가변 확장 (v3.7.0)
# 섹션당 ◦ 슬롯 2개를 채우고, 초과 항목은 anchor(2번째 ◦) 직후에 동적 삽입.
# 섹션당 항목 수 제한 없음 — 콘텐츠 양에 맞춰 ◦ 단락이 늘어난다.
# ◦ 항목 단락: paraPrIDRef=31, charPrIDRef=14 (skeleton 확인값).
# ────────────────────────────────────────────────────────────────
EXPANSION_RULES_1P = [
    {"key": "섹션1_항목", "slots": ["text_005", "text_006"], "para_pr": "31", "char_pr": "14", "anchor": "text_006", "slot_indent": "", "dynamic_indent": ""},
    {"key": "섹션2_항목", "slots": ["text_010", "text_011"], "para_pr": "31", "char_pr": "14", "anchor": "text_011", "slot_indent": "", "dynamic_indent": ""},
    {"key": "섹션3_항목", "slots": ["text_015", "text_016"], "para_pr": "31", "char_pr": "14", "anchor": "text_016", "slot_indent": "", "dynamic_indent": ""},
    {"key": "섹션4_항목", "slots": ["text_020", "text_021"], "para_pr": "31", "char_pr": "14", "anchor": "text_021", "slot_indent": "", "dynamic_indent": ""},
]


def _append_1p_extra_sections(values: dict, dynamic: dict, xml: str) -> tuple:
    """1p_추가섹션(□ 제목 + ◦항목 마커 배열)을 4번째 섹션 마지막 ◦ 슬롯 뒤에 동적 삽입.

    1p 템플릿 □ 슬롯은 4개(SECTION_BASE)뿐이라, 5번째 이상 섹션은 여기서 동적 단락으로 붙인다.
    □ 라인은 기존 □ 슬롯(text_019) 서식, ◦/-/※ 라인은 ◦ 항목 서식(paraPr31/charPr14)과 통일.
    콘텐츠가 짧으면 5개 이상도 한 장에 들어간다(풀버전 _append_extra_sections와 동일 원리).
    """
    new_values = dict(values)
    items = new_values.pop("1p_추가섹션", None)
    if not items or not isinstance(items, list):
        return new_values, dynamic
    anchor = "text_021"  # 4번째 섹션의 마지막 ◦ 슬롯 — 그 섹션 항목들 뒤에 이어 삽입
    sec_pp, sec_cp = _slot_para_char(xml, "text_019")  # □ 슬롯 서식(없으면 기본 □)
    blocks = []
    for line in items:
        if line.startswith("□"):
            blocks.append((line, sec_pp, sec_cp, ""))   # □ 섹션 제목
        else:
            blocks.append((line, "31", "14", ""))         # ◦/-/※ 항목(1p ◦ 서식)
    dynamic.setdefault(anchor, []).extend(blocks)
    return new_values, dynamic


def apply_1p_expansion(values: dict, xml: str) -> tuple:
    """1페이지 보고서 ◦ 항목 가변 확장 + 5번째 이상 섹션 동적 삽입 (섹션·항목 수 제한 없음)."""
    new_values, dynamic = normalize_body_input(values, EXPANSION_RULES_1P)
    new_values, dynamic = _append_1p_extra_sections(new_values, dynamic, xml)
    new_xml, n_inserted = insert_dynamic_paragraphs(xml, dynamic)
    summary = {
        "extra_paragraphs_inserted": n_inserted,
        "extra_by_anchor": {a: [item[0][:40] for item in items]
                            for a, items in dynamic.items() if items},
    }
    return new_values, new_xml, summary


# ────────────────────────────────────────────────────────────────
# 풀버전 보고서(format_full) ○ 항목 가변 확장 (v3.7.0)
# 절(□)당 ○ 항목 슬롯 1개를 채우고, 초과 항목은 그 직후에 동적 ○ 단락으로 삽입.
# ○ 항목 단락: paraPrIDRef=38(절1만 44), charPrIDRef=54 (skeleton 확인값).
# 절당 항목 수 제한 없음 — 콘텐츠 양에 맞춰 ○ 단락이 늘어난다.
# ────────────────────────────────────────────────────────────────
EXPANSION_RULES_FULL = [
    {
        "key": f"절{i}_항목",
        # ○ 항목 + 세부(-)/주석(※) 을 모두 동적 단락으로 통일(slots=[])해 paraPr38 baseline 을
        # 공유한다(슬롯 paraPr 와 들여쓰기가 어긋나 위계가 역전되던 문제 해결). 마커(◦/-/※)와
        # 전각공백 들여쓰기는 buildValuesFull 이 각 원소 텍스트에 직접 넣는다(dynamic_indent="").
        # anchor 는 □ 절 단락 — 그 직후에 삽입한다.
        "slots": [],
        "para_pr": "38",
        "char_pr": "54",
        "anchor": f"본문_절_{i:03d}",
        "slot_indent": "",
        "dynamic_indent": "",
    }
    for i in range(1, 13)
]


# 장별 마지막 본문 □ 슬롯 (CHAPTER_SEC_SLOTS 각 장 마지막 슬롯) — 추가절 anchor.
# 본문 □ 슬롯을 초과한 절(□+○)을 이 슬롯 뒤에 동적 삽입해 목차 절 수와 본문을 맞춘다.
CHAPTER_LAST_BODY_SLOT = {
    1: "본문_절_001", 2: "본문_절_003", 3: "본문_절_005",
    4: "본문_절_007", 5: "본문_절_010", 6: "본문_절_012",
}


def _slot_para_char(xml: str, token: str) -> tuple:
    """{{token}} 이 든 hp:p 의 paraPrIDRef/charPrIDRef 추출 (없으면 □ 절 기본값)."""
    i = xml.find("{{" + token + "}}")
    if i == -1:
        return "37", "53"
    head = xml[xml.rfind("<hp:p ", 0, i):i + 80]
    pp = re.search(r'paraPrIDRef="(\d+)"', head)
    cp = re.search(r'charPrIDRef="(\d+)"', head)
    return (pp.group(1) if pp else "37"), (cp.group(1) if cp else "53")


def _append_extra_sections(values: dict, dynamic: dict, xml: str) -> tuple:
    """장N_추가절(□ 제목 + ◦항목 마커 배열)을 장의 마지막 □ 슬롯 뒤에 동적 삽입.

    □ 라인은 그 장 □ 슬롯과 동일한 paraPr/charPr(시각 일치), ◦/-/※ 라인은
    ○ 항목과 동일한 paraPr38/charPr54. dynamic[anchor] 에 extend 하므로 그 장
    마지막 절의 ○ 항목 뒤에 이어 삽입된다(□ 제목 → 항목 순서 보존).
    """
    new_values = dict(values)
    for ci in range(1, 7):
        key = f"장{ci}_추가절"
        items = new_values.pop(key, None)
        if not items or not isinstance(items, list):
            continue
        anchor = CHAPTER_LAST_BODY_SLOT[ci]
        sec_pp, sec_cp = _slot_para_char(xml, anchor)  # 그 장 □ 슬롯 서식
        blocks = []
        for line in items:
            if line.startswith("□"):
                blocks.append((line, sec_pp, sec_cp, ""))   # □ 절 제목
            else:
                blocks.append((line, "38", "54", ""))         # ◦/-/※ 항목
        dynamic.setdefault(anchor, []).extend(blocks)
    return new_values, dynamic


import os

# 일정표(구분/일정/내용) 채움 템플릿 — 표로 정리할 내용(추진일정 등)을 동적 배치할 때 사용.
_TABLE_TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "templates", "format_full",
    "iljungpyo_template.xml")


def _xesc(s) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build_filled_table(rows: list):
    """일정표 템플릿(헤더 구분/일정/내용 + 4 데이터행)을 rows(≤4)로 채운 hp:p 블록 반환.

    rows: [[구분, 일정, 내용], ...] (각 행 3열). 행이 4개 미만이면 빈 데이터행은 제거.
    실패(템플릿 없음/행 0개) 시 None.
    """
    rows = [r for r in (rows or []) if any(str(c).strip() for c in r)][:4]
    if not rows:
        return None
    try:
        tpl = open(_TABLE_TEMPLATE_PATH, encoding="utf-8").read()
    except OSError:
        return None
    n = len(rows)
    # 데이터행(<hp:tr> 1~4) 중 뒤쪽 (4-n)개 제거 → 헤더 + n행. rowCnt 갱신.
    trs = [(m.start(), m.end())
           for m in re.finditer(r'<hp:tr\b.*?</hp:tr>', tpl, re.S)]
    for idx in range(4, n, -1):           # 4,3,…,n+1 (뒤에서부터 안전 제거)
        a, b = trs[idx]
        tpl = tpl[:a] + tpl[b:]
    tpl = re.sub(r'rowCnt="\d+"', 'rowCnt="%d"' % (1 + n), tpl, count=1)
    # 셀 토큰 채우기: 셀 i(0~) → 행 i//3, 열 i%3
    for i in range(12):
        r, c = divmod(i, 3)
        val = rows[r][c] if r < n and c < len(rows[r]) else ""
        tpl = tpl.replace("{{일정표_셀_%03d}}" % (i + 1), _xesc(val))
    tpl = re.sub(r'\{\{일정표_셀_\d+\}\}', '', tpl)   # 제거된 행의 잔여 토큰 정리
    return tpl


def _remove_empty_chapter_boxes(values: dict, xml: str) -> tuple:
    """장NN_제목이 빈 장(미사용 장)의 장 박스 표를 감싼 hp:p 째 제거.

    양식은 장 칸이 6개인데 보고서 장 수가 그보다 적으면 빈 로마자 박스(Ⅴ/Ⅵ 등)가
    남는다. 내용 없는 장 박스는 표출하지 않는다. 장 본문 슬롯(본문_절 등)은 이미
    EMPTY_MARKER 로 remove_empty_marker_paragraphs 가 제거하므로 박스만 정리하면 된다.
    """
    removed = 0
    for ci in range(1, 7):
        tok = f"장{ci:02d}_제목"
        val = values.get(tok, "")
        if val and val != EMPTY_MARKER and str(val).strip():
            continue  # 채워진 장 → 유지
        marker = "{{" + tok + "}}"
        i = xml.find(marker)
        if i == -1:
            continue
        ts = xml.rfind("<hp:tbl", 0, i)
        if ts == -1:
            continue
        ps = xml.rfind("<hp:p ", 0, ts)  # 장 박스 표를 감싼 hp:p
        if ps == -1:
            continue
        pe = _find_matching_p_close(xml, ps)
        if pe == -1:
            continue
        block = xml[ps:pe]
        # 안전: 감싼 hp:p 에 장 박스 표 1개 + 해당 제목 토큰만 (다른 장 침범 방지)
        if block.count("<hp:tbl") != 1 or marker not in block:
            continue
        xml = xml[:ps] + xml[pe:]
        removed += 1
    return xml, removed


def apply_full_expansion(values: dict, xml: str) -> tuple:
    """풀버전 보고서 절·항목 가변 확장 + 빈 장 박스 정리.

    ① 절당 ○ 항목 무제한 확장(EXPANSION_RULES_FULL) +
    ② 본문 □ 슬롯 초과 절을 장N_추가절로 동적 삽입(목차 절 수와 본문 일치) +
    ③ 내용 없는 장 박스(미사용 장 로마자 칸) 제거.
    """
    new_values, dynamic = normalize_body_input(values, EXPANSION_RULES_FULL)
    new_values, dynamic = _append_extra_sections(new_values, dynamic, xml)
    # ③ 일정표 — 표로 정리할 내용(일정표_rows)이 있으면 해당 장 끝(일정표_anchor) 뒤에 배치.
    #    dynamic[anchor] 끝에 추가하므로 그 장 절 항목·추가절 다음에 표가 온다.
    n_table = 0
    t_anchor = new_values.pop("일정표_anchor", None)
    t_rows = new_values.pop("일정표_rows", None)
    if t_anchor and t_rows:
        block = build_filled_table(t_rows)
        if block:
            dynamic.setdefault(t_anchor, []).append(("__RAWBLOCK__", block))
            n_table = 1
    new_xml, n_inserted = insert_dynamic_paragraphs(xml, dynamic)
    new_xml, n_boxes = _remove_empty_chapter_boxes(new_values, new_xml)
    summary = {
        "extra_paragraphs_inserted": n_inserted,
        "empty_chapter_boxes_removed": n_boxes,
        "schedule_table_inserted": n_table,
        "extra_by_anchor": {a: [item[0][:40] for item in items]
                            for a, items in dynamic.items() if items},
    }
    return new_values, new_xml, summary


# ────────────────────────────────────────────────────────────────
# 빈 placeholder 단락 제거 (v3.6.8 신규)
# ────────────────────────────────────────────────────────────────
EMPTY_MARKER = "\u200b\u200b__EMPTY_PLACEHOLDER__\u200b\u200b"


def remove_empty_marker_paragraphs(xml: str) -> tuple:
    """
    EMPTY_MARKER 가 든 *가장 안쪽* hp:p 처리:
      - **hp:tbl 또는 hp:subList 가 든 hp:p (표 감싸기) 는 무조건 단락 보존**,
        EMPTY_MARKER 만 제거. 발신부 표 같은 중요 구조 보호.
      - 그 외에 의미 있는 텍스트 있으면 마커만 제거 (단락 보존).
      - 다 비었으면 hp:p 통째 제거.

    Returns (new_xml, n_p_removed, n_marker_only_cleaned)
    """
    n_removed = 0
    n_marker_only = 0
    while True:
        idx = xml.find(EMPTY_MARKER)
        if idx == -1:
            break
        p_start = xml.rfind('<hp:p ', 0, idx)
        if p_start == -1:
            xml = xml[:idx] + xml[idx + len(EMPTY_MARKER):]
            continue
        p_end = _find_matching_p_close(xml, p_start)
        if p_end == -1:
            xml = xml[:idx] + xml[idx + len(EMPTY_MARKER):]
            continue
        block = xml[p_start:p_end]

        # 보존 예외: hp:tbl 든 단락은 표 보존을 위해 무조건 마커만 제거
        if '<hp:tbl' in block or '<hp:subList' in block:
            new_block = block.replace(EMPTY_MARKER, "")
            xml = xml[:p_start] + new_block + xml[p_end:]
            n_marker_only += 1
            continue

        # 일반 단락: 의미 있는 텍스트 검사
        texts = re.findall(r'<hp:t\b[^>]*>(.*?)</hp:t>', block, re.DOTALL)
        has_meaningful = False
        for t in texts:
            cleaned = t.replace(EMPTY_MARKER, "").strip()
            if cleaned:
                has_meaningful = True
                break
        if has_meaningful:
            new_block = block.replace(EMPTY_MARKER, "")
            xml = xml[:p_start] + new_block + xml[p_end:]
            n_marker_only += 1
        else:
            xml = xml[:p_start] + xml[p_end:]
            n_removed += 1
    return xml, n_removed, n_marker_only


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 4:
        print("사용법: python3 expand_gongmun_body.py <skeleton.xml> <values.json> <output.xml>")
        sys.exit(1)
    import json
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        xml = f.read()
    with open(sys.argv[2], "r", encoding="utf-8") as f:
        values = json.load(f)
    new_values, new_xml, summary = apply_body_expansion(values, xml)
    with open(sys.argv[3], "w", encoding="utf-8") as f:
        f.write(new_xml)
    print(f"✅ {summary['extra_paragraphs_inserted']} 단락 추가")
