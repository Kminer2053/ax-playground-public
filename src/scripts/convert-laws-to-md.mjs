// 법제처 수집 원본(JSON) → 적재용 md 변환 (data/laws/raw → data/laws/md)
// 프런트매터는 regulations-2026 관례(규정명·규정종류·최종시행일·원본파일·비고)를 따라 기존 ingest가 그대로 읽는다.
// 부칙 전문은 잡음 방지를 위해 md에서 제외(원본 JSON에 보존) — 시행일은 프런트매터로 전달.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const RAW_DIR = path.join(ROOT, "data/laws/raw");
const MD_DIR = path.join(ROOT, "data/laws/md");
fs.mkdirSync(MD_DIR, { recursive: true });

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const clean = (s) => String(s ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
const dot = (yyyymmdd) => {
  const m = String(yyyymmdd || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : String(yyyymmdd || "");
};

function lawToMd(meta, body) {
  const l = body["법령"];
  const b = l["기본정보"] || {};
  const name = b["법령명_한글"] || meta.hit?.name;
  const lines = [];
  for (const a of arr(l["조문"]?.["조문단위"])) {
    if (a["조문여부"] !== "조문") { lines.push(clean(a["조문내용"]), ""); continue; }
    const parts = [clean(a["조문내용"])];
    for (const h of arr(a["항"])) {
      if (h["항내용"]) parts.push(clean(h["항내용"]));
      for (const ho of arr(h["호"])) {
        if (ho["호내용"]) parts.push(clean(ho["호내용"]));
        for (const mok of arr(ho["목"])) if (mok["목내용"]) parts.push(clean(arr(mok["목내용"]).join("\n")));
      }
    }
    lines.push(parts.filter(Boolean).join("\n"), "");
  }
  return {
    name,
    kindCat: "법령",
    efYd: dot(b["시행일자"]),
    extra: `${b["법령구분"]?.["content"] || meta.hit?.kind || ""} · ${b["소관부처"]?.["content"] || meta.hit?.dept || ""} · 공포 ${dot(b["공포일자"])} 제${b["공포번호"]}호`,
    body: lines.join("\n"),
  };
}

function admrulToMd(meta, body) {
  const s = body["AdmRulService"];
  const name = s["행정규칙명"] || meta.hit?.name;
  const lines = arr(s["조문내용"]).map(clean);
  return {
    name,
    kindCat: "행정규칙",
    efYd: dot(s["시행일자"] || meta.hit?.efYd),
    extra: `${s["행정규칙종류"] || meta.hit?.kind || ""} · ${s["소관부처명"] || meta.hit?.dept || ""} · 발령 ${dot(s["발령일자"])} 제${s["발령번호"] || "?"}호`,
    body: lines.join("\n\n"),
  };
}

let ok = 0, fail = 0;
for (const f of fs.readdirSync(RAW_DIR).filter((x) => x.endsWith(".json")).sort()) {
  try {
    const { _meta, body } = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), "utf8"));
    const conv = body["법령"] ? lawToMd(_meta, body) : admrulToMd(_meta, body);
    const md = `---
규정명: ${conv.name}
규정종류: ${conv.kindCat}
최종시행일: ${conv.efYd}
원본파일: 법제처 국가법령정보 DRF (${_meta.target}, 수집 ${(_meta.collectedAt || "").slice(0, 10)})
비고: 외부법령·행정규칙 원문 — ${conv.extra} — law.go.kr
---${conv.name}

${conv.body}
`;
    fs.writeFileSync(path.join(MD_DIR, `${conv.kindCat}_${conv.name.replace(/[/\\:]/g, "_")}.md`), md);
    ok++;
  } catch (e) {
    console.log(`! 변환 실패: ${f} — ${e.message}`);
    fail++;
  }
}
console.log(`변환 완료: ${ok} / 실패 ${fail} → data/laws/md/`);
