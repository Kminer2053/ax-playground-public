# three.module.min.js(+core)를 window.THREE 전역 단일 스크립트로 변환 — 스코프 격리(IIFE)로 미니파이 이름 충돌 방지
import re

core = open("package/build/three.core.min.js").read()
mod = open("package/build/three.module.min.js").read()

def parse_export_pairs(clause: str):
    """'a as B, C, d as E' → [('B','a'), ('C','C'), ('E','d')] (public, internal)"""
    pairs = []
    for part in clause.split(","):
        part = part.strip()
        if not part: continue
        m = re.match(r"^(\S+)\s+as\s+(\S+)$", part)
        if m: pairs.append((m.group(2), m.group(1)))
        else: pairs.append((part, part))
    return pairs

# ── core: 마지막 export{...} 제거 + 매핑 수집 ──
core_exports = []
def strip_exports(src):
    pairs = []
    def repl(m):
        pairs.extend(parse_export_pairs(m.group(1)))
        return ""
    out = re.sub(r"export\s*\{([^}]*)\}\s*;?", repl, src)
    return out, pairs

core_body, core_pairs = strip_exports(core)
assert core_pairs, "core export 파싱 실패"

# ── module: import 문 → __CORE__ 구조 분해, export 제거 ──
imp_m = re.search(r"import\s*\{([^}]*)\}\s*from\s*\"\./three\.core\.min\.js\"\s*;?", mod)
assert imp_m, "module import 파싱 실패"
imp_pairs = []  # (public, local)
for part in imp_m.group(1).split(","):
    part = part.strip()
    m = re.match(r"^(\S+)\s+as\s+(\S+)$", part)
    if m: imp_pairs.append((m.group(1), m.group(2)))
    else: imp_pairs.append((part, part))
mod_body = mod.replace(imp_m.group(0), "", 1)

# 재수출(export{...}from"./core") → __CORE__.<원본> 참조로 매핑 후 제거 (일반 export보다 먼저 처리)
reexport_pairs = []
def repl_reexport(m):
    for pub, orig in parse_export_pairs(m.group(1)):
        reexport_pairs.append((pub, f"__CORE__.{orig}"))
    return ""
mod_body = re.sub(r"export\s*\{([^}]*)\}\s*from\s*\"[^\"]+\"\s*;?", repl_reexport, mod_body)

mod_body, mod_pairs = strip_exports(mod_body)
mod_pairs = reexport_pairs + mod_pairs
assert mod_pairs, "module export 파싱 실패"

destructure = ",".join(f"{pub}:{loc}" for pub, loc in imp_pairs)
core_ret = ",".join(f"{pub}:{internal}" for pub, internal in core_pairs)
mod_ret = ",".join(f"{pub}:{internal}" for pub, internal in mod_pairs)

out = (
    "/* three.js r185 — 전역 번들(아티팩트 CSP용 오프라인 인라인, MIT) */\n"
    "(function(){\n"
    "const __CORE__=(function(){\"use strict\";\n" + core_body + "\nreturn{" + core_ret + "};})();\n"
    "const __MOD__=(function(){\"use strict\";const{" + destructure + "}=__CORE__;\n" + mod_body + "\nreturn{" + mod_ret + "};})();\n"
    "window.THREE=Object.assign({},__CORE__,__MOD__);\n"
    "})();\n"
)
open("three-global.js", "w").write(out)
print(f"three-global.js 생성: {len(out):,}자 | core exports {len(core_pairs)} | module exports {len(mod_pairs)} | imports {len(imp_pairs)}")
