# -*- coding: utf-8 -*-
"""약식 좌우 비교 HTML — /tmp/quick_<A>.json vs /tmp/quick_<B>.json → data/benchmark/results/quick-compare.html
   사용: python3 src/scripts/build-quick-compare.py <A> <B> [표시명A] [표시명B]"""
import json, re, sys

A = sys.argv[1] if len(sys.argv) > 1 else "A"
B = sys.argv[2] if len(sys.argv) > 2 else "B"
NA = sys.argv[3] if len(sys.argv) > 3 else A
NB = sys.argv[4] if len(sys.argv) > 4 else B

def load(l): return json.load(open(f"/tmp/quick_{l}.json", encoding="utf-8"))
da, db = load(A), load(B)
ia = {(r["q"], r["mode"]): r for r in da}
ib = {(r["q"], r["mode"]): r for r in db}

seen, queries = set(), []
for r in da:
    if r["q"] not in seen:
        seen.add(r["q"]); queries.append({"q": r["q"], "cat": r["cat"], "expect": r["expect"]})

def regs(a): return len(set(re.findall(r"「([^」]+)」", a or "")))
def cited(a, expect, cat): return None if cat == "범위밖" else any(e in (a or "") for e in expect)

def cell(idx, q, mode):
    r = idx.get((q["q"], mode), {}); a = r.get("answer", "")
    return {"answer": a, "refs": r.get("refs", []), "len": len(a), "regs": regs(a), "cited": cited(a, q["expect"], q["cat"])}

DATA = []
for q in queries:
    c = {m: {"A": cell(ia, q, m), "B": cell(ib, q, m)} for m in ["fast", "deep"]}
    DATA.append({"q": q["q"], "cat": q["cat"], "expect": q["expect"], "cell": c})
payload = json.dumps(DATA, ensure_ascii=False)

frag = '''<div style="max-width:1100px;margin:0 auto;padding:1rem">
<h2 style="font-weight:500">약식 좌우 비교 — __NA__ vs __NB__ (유형별 10문항)</h2>
<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0">
  <select id="qsel" style="flex:1;min-width:240px;height:36px;border:0.5px solid var(--border-strong);border-radius:8px;background:var(--surface-2);color:var(--text-primary);padding:0 8px"></select>
  <div style="display:inline-flex;border:0.5px solid var(--border-strong);border-radius:8px;overflow:hidden">
    <button id="mFast" style="border:0;padding:8px 16px;background:var(--surface-1);color:var(--text-primary);cursor:pointer">간편</button>
    <button id="mDeep" style="border:0;padding:8px 16px;border-left:0.5px solid var(--border);background:transparent;color:var(--text-primary);cursor:pointer">심층</button>
  </div>
</div>
<div id="meta" style="font-size:13px;color:var(--text-secondary);margin-bottom:12px"></div>
<div id="cards" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
</div>
<script>
const DATA=__PAYLOAD__, NA="__NA__", NB="__NB__";
let mode="fast";
function md(s){if(!s)return '<p style="color:var(--text-muted)">(없음)</p>';const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");const il=t=>esc(t).replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>").replace(/「([^」]+)」/g,'<span style="color:var(--text-accent);font-weight:500">「$1」</span>');let h="",inL=false;const cl=()=>{if(inL){h+="</ul>";inL=false;}};for(const raw of s.split(/\\r?\\n/)){const t=raw.trim();if(!t){cl();continue;}let m;if(m=t.match(/^#{2,4}\\s+(.*)/)){cl();h+='<div style="font-weight:500;font-size:13.5px;margin:10px 0 4px">'+il(m[1])+"</div>";}else if((m=t.match(/^[-*]\\s+(.*)/))||(m=t.match(/^\\d+\\.\\s+(.*)/))){if(!inL){h+='<ul style="margin:4px 0;padding-left:16px">';inL=true;}h+='<li style="margin:3px 0">'+il(m[1])+"</li>";}else{cl();h+='<p style="margin:5px 0">'+il(t)+"</p>";}}cl();return h;}
function badge(t,bg,fg){return '<span style="font-size:11px;padding:2px 7px;border-radius:999px;background:'+bg+';color:'+fg+';margin-left:5px;white-space:nowrap">'+t+"</span>";}
function col(c,cat,name){let flag;if(cat==="범위밖")flag=c.regs===0?badge("지어냄 없음","var(--bg-success)","var(--text-success)"):badge("규정"+c.regs+"건(부적절)","var(--bg-danger)","var(--text-danger)");else flag=c.cited?badge("정답✓","var(--bg-success)","var(--text-success)"):badge("누락✗","var(--bg-danger)","var(--text-danger)");const rf=c.refs.length?c.refs.map(r=>'<span style="font-size:10.5px;padding:1px 7px;border-radius:999px;border:0.5px solid var(--border);color:var(--text-secondary);margin:2px 3px 0 0;display:inline-block">'+r+"</span>").join(""):'<span style="color:var(--text-muted);font-size:11px">없음</span>';return '<div style="background:var(--surface-2);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px"><div style="display:flex;align-items:center;flex-wrap:wrap;margin-bottom:8px;padding-bottom:8px;border-bottom:0.5px solid var(--border)"><span style="font-weight:500">'+name+'</span><span style="flex:1"></span>'+badge(c.len+"자","var(--surface-1)","var(--text-secondary)")+badge("규정"+c.regs,"var(--surface-1)","var(--text-secondary)")+flag+'</div><div style="font-size:13px;line-height:1.65;color:var(--text-primary)">'+md(c.answer)+'</div><div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border)"><span style="font-size:10.5px;color:var(--text-muted)">참조 </span>'+rf+"</div></div>";}
function render(){const i=+document.getElementById("qsel").value,d=DATA[i];const ex=d.cat==="범위밖"?"정답 없음(무관 질문)":"정답: "+d.expect.map(e=>"「"+e+"」").join(", ");document.getElementById("meta").innerHTML="유형 <b style='color:var(--text-primary)'>"+d.cat+"</b> · "+ex;document.getElementById("mFast").style.background=mode==="fast"?"var(--surface-1)":"transparent";document.getElementById("mDeep").style.background=mode==="deep"?"var(--surface-1)":"transparent";const cc=d.cell[mode];document.getElementById("cards").innerHTML=col(cc.A,d.cat,NA)+col(cc.B,d.cat,NB);}
(function(){const sel=document.getElementById("qsel");DATA.forEach((d,i)=>{const o=document.createElement("option");o.value=i;o.textContent=(i+1)+". ["+d.cat+"] "+d.q;sel.appendChild(o);});sel.addEventListener("change",render);document.getElementById("mFast").addEventListener("click",()=>{mode="fast";render();});document.getElementById("mDeep").addEventListener("click",()=>{mode="deep";render();});render();})();
</script>'''
frag = frag.replace("__PAYLOAD__", payload).replace("__NA__", NA).replace("__NB__", NB)

STYLE = """<style>
:root{--surface-2:#fff;--surface-1:#f5f4ef;--surface-0:#faf9f5;--text-primary:#1f1e1c;--text-secondary:#6b6a65;--text-muted:#9a9892;--text-accent:#185fa5;--text-success:#0f6e56;--text-danger:#a32d2d;--bg-success:#e1f5ee;--bg-danger:#fcebeb;--border:#e5e3da;--border-strong:#cfccc0;--border-accent:#378add;--radius:8px}
@media (prefers-color-scheme:dark){:root{--surface-2:#2b2a28;--surface-1:#232220;--surface-0:#1a1917;--text-primary:#ece9e2;--text-secondary:#a8a69e;--text-muted:#75736c;--text-accent:#85b7eb;--text-success:#5dcaa5;--text-danger:#f09595;--bg-success:#085041;--bg-danger:#501313;--border:#3a3835;--border-strong:#4a4744}}
body{background:var(--surface-0);color:var(--text-primary);font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;margin:0}
</style>"""
doc = "<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>약식 비교</title>" + STYLE + "</head><body>" + frag + "</body></html>"

out = "data/benchmark/results/quick-compare.html"
open(out, "w", encoding="utf-8").write(doc)
print("저장:", out, "(", len(DATA), "문항,", NA, "vs", NB, ")")
