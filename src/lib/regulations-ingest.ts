/**
 * 사규 적재 파이프라인 (단일 출처). CLI(import-regulations.ts)·관리자 적재 API 공용.
 *
 * 설계(이번 세션 노하우 집약):
 *  - 적응형 청킹: 제N조 커버리지→JO / 번호계층(목차行 제외, 첫 헤딩 40%이내)→NUM / 제N장·절→JANG / 그 외→PAGE.
 *  - 머리말(제1조 이전 서문)·부칙·별표 분리 보존, 정제자 메타메모 제거, 중복 청크명 페이지 접미.
 *  - 표 복구: kordoc <table>→GFM 파이프 표, 개요 아웃라인 헤더 제거.
 *  - 공백 안전정제: txt는 "공백만" 변경(글자 불변 검증), md는 단일글자 4자+ 런만.
 *  - 자가검수(audit): 보존율·빈조문·중복·부칙누수·항유실·중간잘림 → good/warn/bad 게이트.
 */
import fs from "node:fs";
import path from "node:path";

// ───────── 타입 ─────────
export type Meta = Record<string, string>;
export type Chunk = { name: string; fullText: string; order: number; page: string; via: string };
export type Doc = {
  title: string;
  category: string;
  docNumber: string;
  year: string;
  articles: Chunk[];
  metadata: Record<string, unknown>;
  via: string;
  pages: number;
};
export type Audit = {
  sourceChars: number;
  chunkChars: number;
  retentionPct: number;
  /** 목차(점선 리더) 줄을 분모에서 뺀 보존율 — 표지·목차가 두꺼운 문서에서 실제 본문 유실을 덜 가리게. */
  retentionCorePct: number;
  chunks: number;
  empty: number;
  dup: number;
  buchikLeak: number;
  midSentence: number;
  orphanHang: number;
  emptyTitle: boolean;
  flags: string[];
  score: "good" | "warn" | "bad";
};

// ───────── 메타/본문 파싱 ─────────
export function parseMeta(raw: string): { format: "txt" | "md"; meta: Meta; body: string } {
  raw = raw.replace(/^﻿/, ""); // BOM 제거(txt 헤더 [문서명] 파싱 방해)
  const lines = raw.split(/\r?\n/);
  // txt: [문서명] 헤더
  if (lines.slice(0, 8).some((l) => /^\[(문서명|처리일|총페이지)\]/.test(l))) {
    const meta: Meta = {};
    for (const l of lines.slice(0, 12)) {
      const m = l.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim();
    }
    const sep = raw.indexOf("=".repeat(20));
    const body = sep >= 0 ? raw.slice(raw.indexOf("\n", sep) + 1) : raw;
    return { format: "txt", meta, body };
  }
  // md: 프런트매터(맨 앞 ---/\--- ~ 닫는 ---)
  const meta: Meta = {};
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || /^\\?-{3,}\s*$/.test(lines[i].trim()))) i++;
  let bodyStart = i;
  for (; i < lines.length; i++) {
    if (/^\\?-{3,}\s*$/.test(lines[i].trim())) { bodyStart = i + 1; break; }
    const m = lines[i].match(/^([가-힣A-Za-z][가-힣A-Za-z0-9_ ]*?):\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
    else { bodyStart = i; break; }
  }
  return { format: "md", meta, body: lines.slice(bodyStart).join("\n") };
}

export function baseName(p: string): string { return path.basename(p).normalize("NFC"); } // macOS NFD → NFC
export function titleFromFile(p: string): string {
  let s = baseName(p).replace(/\.(txt|md|hwp|hwpx|pdf|docx|xlsx)$/i, "").replace(/_RAG_정제텍스트.*$/, "");
  s = s.replace(/^[★☆]+\s*/, "").replace(/^\d+[.)]\s*/, ""); // 선두 별표·번호
  s = s.replace(/^(규정|세칙|지침|매뉴얼|편람|계약서)\s*제\s*\d+\s*[호조][_\s]*/, ""); // 종류·연번 접두
  // 원본 파일명 "제N호(이름)-날짜" → 괄호 안 이름만
  const paren = s.match(/^[(（]([^)）]+)[)）]/);
  if (paren) return paren[1].trim();
  return s.replace(/[_]+/g, " ")
    .replace(/[(（][^)）]*(?:개정|제정|시행|기준)[^)）]*[)）]\s*$/, "") // 말미 개정정보 괄호
    .replace(/[-–]\s*\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\.?\s*$/, "")          // 말미 날짜
    .trim();
}
/** 파일명에서 시행일(YYYY.MM.DD/YYYY-MM-DD) → "YYYY-MM-DD". 없으면 "". */
export function dateFromName(p: string): string {
  const m = baseName(p).match(/(20\d{2})[.\-](\d{1,2})[.\-](\d{1,2})/);
  return m ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : "";
}
const isoDate = (y: string, m: string, d: string) => `${y}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`;
/**
 * 부칙 시행일: "이 지침/규정/세칙…은 YYYY.M.D…부터 시행" 중 **가장 최신**.
 *  부칙은 제정→개정이 시간순 나열되므로 최신 부칙이 현행 시행일이다(첫 매치=제정일 오인 방지).
 *  문서가 스스로 밝힌 시행일이라 파일명·제목보다 신뢰도가 높다.
 */
export function enforceDateFromBody(body: string): string {
  const all = [...body.matchAll(/이\s*(?:지침|규정|세칙|규칙|기준|예규|요령)[^\n]{0,50}?(20\d{2})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})\s*[.일]?[^\n]{0,25}?시행/g)].map((m) => isoDate(m[1], m[2], m[3]));
  return all.length ? (all.sort().at(-1) || "") : "";
}
/** <개정 …>·연혁 날짜 중 최신(현행 시행일 근사) — 최후 폴백. */
export function markerDateFromBody(body: string): string {
  const dates = [...body.matchAll(/(20\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\./g)].map((m) => isoDate(m[1], m[2], m[3]));
  return dates.length ? (dates.sort().at(-1) || "") : "";
}
/** 본문 시행일(파일명·메타 폴백): ①최신 부칙 시행일 → ②최신 마커. → "YYYY-MM-DD". */
export function dateFromBody(body: string): string {
  return enforceDateFromBody(body) || markerDateFromBody(body);
}
export function docNumberFromName(p: string): string {
  // 파일명 연번(제N호). 일부 세칙 파일명이 '제N조'로 오기되어 [호조] 모두 허용(원본은 호).
  const m = baseName(p).match(/제\s*(\d+)\s*[호조]/);
  return m ? `제${m[1]}호` : "";
}
export function revisionFromName(p: string): string {
  const m = baseName(p).match(/\(([^)]*(?:개정|제정)[^)]*)\)/);
  return m ? m[1].trim() : "";
}
/** "윤리 규정(2024년도 8월 개정)" → {title:"윤리 규정", revision:"2024년도 8월 개정"} */
export function splitTitleRevision(s: string): { title: string; revision: string } {
  const m = s.match(/\s*\(\s*([^)]*(?:개정|제정|시행)[^)]*)\s*\)\s*$/);
  return m ? { title: s.slice(0, m.index).trim(), revision: m[1].trim() } : { title: s.trim(), revision: "" };
}
/** 표시용 시행일 정규화: "2026-02-04 (부칙 …장황)" → "2026-02-04". 한글일자(2024년도 8월 개정)는 보존. */
export function cleanYear(y: string): string {
  const s = (y || "").trim();
  const iso = s.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  return iso ? `${iso[1]}-${String(+iso[2]).padStart(2, "0")}-${String(+iso[3]).padStart(2, "0")}` : s;
}

// ───────── 추출 텍스트 정규화(kordoc 아웃라인 제거 + 표 파이프 변환) ─────────
/** kordoc HTML <table> → GFM 파이프 표(<br> 보존, 첫 행 뒤 구분행, rowspan/colspan 무시). 고아 <tr>행·잔여 태그도 정리. */
export function htmlTablesToPipe(text: string): string {
  if (!/<table[\s>]|<\/table>|<tr[\s>]/i.test(text)) return text;
  const cellVal = (raw: string) => raw
    .replace(/<br\s*\/?>/gi, "\u0001")          // 셀 내 줄바꿈 → placeholder(태그 제거에서 보호)
    .replace(/<[^>]+>/g, "")                    // 잔여 태그 제거
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)) // HTML 엔티티 복원
    .replace(/\\([^\w\s])/g, "$1")            // kordoc 마크다운 이스케이프(\& \# \[ 등) 해제
    .replace(/\|/g, "／")                        // 셀 내 파이프 → 전각(표 깨짐 방지)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\u0001\s*/g, "<br>")          // 줄바꿈 복원(렌더러가 <br>→개행)
    .trim();
  // 1) 완전한 <table>…</table> → 헤더+구분행 포함 파이프 표(rowspan/colspan을 그리드로 펼침: 병합값을 하위/우측 셀에 반복)
  let t = text.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const grid: string[][] = [];
    const carry = new Map<number, { rowsLeft: number; value: string }>(); // 위 행 rowspan 잔여(열→값)
    const trs = tbl.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = [...tr.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) => ({
        val: cellVal(c[3]),
        rs: Math.max(1, parseInt((c[2].match(/rowspan\s*=\s*["']?(\d+)/i) || [])[1] || "1", 10)),
        cs: Math.max(1, parseInt((c[2].match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || "1", 10)),
      }));
      const row: string[] = [];
      const maxCarry = carry.size ? Math.max(...carry.keys()) : -1;
      let col = 0, ci = 0;
      while (ci < cells.length || col <= maxCarry) {
        const cy = carry.get(col);
        if (cy) { row[col] = cy.value; if (--cy.rowsLeft <= 0) carry.delete(col); col++; continue; }
        if (ci >= cells.length) break;
        const cell = cells[ci++];
        for (let k = 0; k < cell.cs; k++) { row[col] = cell.val; if (cell.rs > 1) carry.set(col, { rowsLeft: cell.rs - 1, value: cell.val }); col++; }
      }
      if (row.length) grid.push(row);
    }
    if (!grid.length) return "";
    const cols = Math.max(...grid.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
    const out = [`| ${pad(grid[0]).join(" | ")} |`, `| ${Array(cols).fill("---").join(" | ")} |`];
    for (let i = 1; i < grid.length; i++) out.push(`| ${pad(grid[i]).join(" | ")} |`);
    return "\n" + out.join("\n") + "\n";
  });
  // 2) 고아 <tr>…</tr>(혼합추출로 여는 <table> 없이 남은 행) → 파이프 데이터행(위 표에 이어붙음)
  t = t.replace(/<tr[\s\S]*?<\/tr>/gi, (tr) => {
    const cells = [...tr.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) => cellVal(c[2]));
    return cells.length ? "\n| " + cells.join(" | ") + " |" : "";
  });
  // 3) 잔여 고아 표 태그 제거(</table>·<table>·떨어진 </td> 등)
  return t.replace(/<\/?(table|thead|tbody|tr|td|th)\b[^>]*>/gi, "");
}
/** 추출 텍스트 정규화: kordoc 헤더("[포맷: …]" + "📑 문서 구조:" 아웃라인) 제거 + 표 파이프 변환 + 잔여 태그 정리. */
export function normalizeExtracted(text: string): string {
  let t = text.replace(/^﻿/, "");
  // kordoc 개요 아웃라인 블록 제거: "[포맷: …]" ~ 첫 실제 제목(###/##/일반 텍스트) 전까지
  if (/^\s*\[포맷:/.test(t) || /📑\s*문서\s*구조/.test(t)) {
    const lines = t.split(/\r?\n/);
    let start = 0;
    let inOutline = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^\[포맷:/.test(l)) { inOutline = true; continue; }
      if (/📑\s*문서\s*구조/.test(l)) { inOutline = true; continue; }
      if (inOutline) {
        // 아웃라인 항목(들여쓰기 - …)·빈줄은 스킵, 실제 본문 시작에서 멈춤
        if (l === "" || /^[-•]/.test(l)) continue;
        start = i; break;
      }
    }
    if (start > 0) t = lines.slice(start).join("\n");
  }
  t = htmlTablesToPipe(t);
  t = t.replace(/^#{1,6}\s+/gm, "");      // kordoc 주입 마크다운 헤딩 접두 제거(조문/별표 마커 보존)
  t = t.replace(/<\/?(?:p|span|div|b|strong|em|i|u)[^>]*>/gi, ""); // 잔여 인라인 태그
  return t;
}

// ───────── 페이지 토큰화 ─────────
const PAGE_RES = [
  /^\\?-{2,}\s*(\S.*?)\s*페이지\s*-{2,}$/, // 선두 \(HWP/MD 추출본의 이스케이프 \---) 허용
  /^<<<PAGE:([^>]+)>>>$/,
  /^<<\[PAGE:([^\]]+)\]\([^)]*\)>>$/,
];
const FRONT_LABELS = /^(표지|목차|차례|제?\s*[·․.]?\s*개정\s*이력|개정이력|일러두기|머리말|서문)$/;
export type PLine = { text: string; page: string; front: boolean };
export function tokenize(body: string): PLine[] {
  const out: PLine[] = [];
  let page = "1";
  let frontByLabel = false;
  for (const rawLn of body.split(/\r?\n/)) {
    const ln = rawLn.trim();
    let marker = false;
    for (const re of PAGE_RES) {
      const m = ln.match(re);
      if (m) { page = m[1].trim(); frontByLabel = FRONT_LABELS.test(page.replace(/\s/g, "")); marker = true; break; }
    }
    if (marker) continue;
    out.push({ text: rawLn, page, front: frontByLabel });
  }
  return out;
}

// ───────── 안전 공백정제(글자 불변) + 수작업 맵 ─────────
export const stripWs = (s: string) => s.replace(/\s/g, "");
let CLEAN_MAP: Record<string, string> | null = null;
function cleanMap(): Record<string, string> {
  if (CLEAN_MAP) return CLEAN_MAP;
  let m: Record<string, string>;
  try { m = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "scripts", "regulations-cleanup-map.json"), "utf8")); }
  catch { m = {}; }
  CLEAN_MAP = m;
  return m;
}
// 정제 통계(ARCH-005). 전역 가변 대신 적재 단위로 만든 통(stat)에 담아, 동시 적재 시 값이 섞이지 않게 한다.
export type MangleStat = { mapped: number; mappedBad: number; unmapped: number };
export const newMangleStat = (): MangleStat => ({ mapped: 0, mappedBad: 0, unmapped: 0 });

function deterministicClean(line: string): string {
  let s = line;
  s = s.replace(/(?:(?<=\s)|^)((?:[가-힣] ){1,}[가-힣])(?=\s|$)/g, (m) => m.replace(/ /g, ""));
  s = s.replace(/제\s*(\d+)\s*(조|장|절|항|호|관)/g, "제$1$2");
  s = s.replace(/(\d+)\s*(인|명|개|년|월|일|호|조|항|차|회)\b/g, "$1$2");
  s = s.replace(/([(（])\s+/g, "$1").replace(/\s+([)）])/g, "$1");
  s = s.replace(/\s+([,.;:])/g, "$1");
  s = s.replace(/[ \t]{2,}/g, " ").trimEnd();
  return s;
}
export const MANGLE_RE = /(?:[가-힣] ){6,}/;
/** md 안전 정비: 단일 한글 7자+ 연속(진짜 글자분리 아티팩트, 예 "전 기 설 비 점 검 기 록 부")만 공백 제거.
 *  4~6자 단음절 나열("을 할 수 있", "및 그", "은 후 그")은 정상 띄어쓰기이므로 보존(run-on 생성 방지). */
export function despaceRun(line: string): string {
  return line.replace(/^\s*-{3,}\s*/, "") // 선두 수평선/대시 아티팩트(kordoc) 제거
    .replace(/(?:[가-힣] ){6,}[가-힣]/g, (m) => m.replace(/ /g, "")).replace(/[ \t]+$/, "");
}
export function cleanLine(line: string, stat?: MangleStat): string {
  const map = cleanMap();
  if (Object.prototype.hasOwnProperty.call(map, line)) {
    const c = map[line];
    if (stripWs(c) === stripWs(line)) { if (stat) stat.mapped++; return c; }
    if (stat) stat.mappedBad++;
    return deterministicClean(line);
  }
  if (MANGLE_RE.test(line) && stat) stat.unmapped++;
  return deterministicClean(line);
}

// ───────── 청킹 ─────────
// 제N조(제목) 또는 제N조 삭제 — 삭제 조문도 번호 보존(괄호제목 없음)
const JE_SPLIT = /(?=\n\s*제\s*\d+\s*조(?:의?\s*\d+)?\s*(?:[(（]|삭\s*제))/g;
// 제목 괄호는 1단계 중첩 허용: "제14조(작업 조정(調整))" 처럼 안쪽 괄호가 있어도 바깥 닫는 괄호까지 머리로.
const HEAD_TOKEN = /^제\s*\d+\s*조(?:의?\s*\d+)?\s*(?:[(（](?:[^()（）]|[(（][^()（）]*[)）])*[)）]|삭\s*제)/;
const DEC_HEAD = /^(\d+(?:\.\d+){0,3})\.?\s+[^\d\s]/;
const TOC_LINE = /[·.\-]{4,}\s*\S*\d+\s*$|\s\d+\s*$/;
const JANG = /^제\s*\d+\s*(장|절)/;
// 장(章)만 — 조 상위 그룹. JO 청킹 시 장 헤더를 별도 청크(구분자)로 분리하는 데 사용(절은 제외).
const CHAPTER = /^제\s*\d+\s*장(?:\s*의\s*\d+)?(?!\s*제?\s*\d+\s*조)/; // 제N장. 뒤에 조문번호(제M조)만 배제 — "제2장 조직"처럼 제목이 '조'로 시작해도 인정
const SECTION_HEAD = /^제\s*\d+\s*절(?:\s*의\s*\d+)?(?!\s*제?\s*\d+\s*조)/; // 제N절(장 하위 절 헤더)
// 한 줄 전체가 개정/신설/이동 등 주석([본장제목변경 …]·<개정 …>·[종전 … 이동 …])인지 — 장 헤더 뒤에 끼어 장 탐지를 막음
const isAmendNote = (t: string) => /^[[<].*[\]>]$/.test(t) && /개정|신설|삭제|변경|이동|종전|본장|본조|\d{4}\s*\./.test(t);
// 계약서 전용: 조를 감싼 괄호(전문점 「【제N조】」 등) 정규화 — 감싼 기호만 벗겨 표준 「제N조」로.
const CONTRACT_BRACKET_JO = /[【〔［]\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*[】〕］]/g;
// 계약서 부속 헤더(라인 시작): (양식N)·(별표N)·(별표N-N)·〈별표1〉·[별표 제N호] 등. 닫는 괄호 뒤가
// 공백/줄끝일 때만 — 본문 인라인 참조("(양식8)으로…", "특약(양식5)")는 조사·문중이라 제외된다.
const ATTACH_HEAD = /^[[(［（〔〈]\s*(양식|별표|별지|서식|부표|부록|붙임)\s*제?\s*\d+(?:\s*[-의]\s*\d+)?\s*호?\s*[\])］）〕〉](?=\s|$)/;
// ── 위계 프로파일링: 헤딩 줄을 레벨 유형으로 분류 → 조(條) 레벨 적응 선택 ──
const ROMAN_CHARS = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ";
const RE_ROMANNUM = new RegExp(`^[${ROMAN_CHARS}]\\s*[-.]\\s*\\d`);  // Ⅱ-1. / Ⅱ.1
const RE_ROMAN = new RegExp(`^[${ROMAN_CHARS}]\\s*[.\\s]`);          // Ⅰ.
/** 헤딩 유형(없으면 null). 순서 중요: 세부→상위. */
type HLevel = "JO" | "JANG" | "ROMANNUM" | "ROMAN" | "DECN" | "DEC1" | "GANADA" | "HANG" | null;
function classifyHeading(t: string): HLevel {
  if (!t) return null;
  if (/^제\s*\d+\s*조(?:의?\s*\d+)?\s*[(（]/.test(t)) return "JO";
  if (/^제\s*\d+\s*[장절]/.test(t)) return "JANG";
  if (RE_ROMANNUM.test(t)) return "ROMANNUM";
  if (RE_ROMAN.test(t)) return "ROMAN";
  if (/^\d+\.\d/.test(t)) return "DECN";          // 1.1 (하위)
  if (/^\d+[.)]\s+\S/.test(t)) return "DEC1";     // 1. (조 후보)
  if (/^[가-힣][.)]\s/.test(t)) return "GANADA";
  if (/^[①-⑳]/.test(t)) return "HANG";
  return null;
}
/** 위계형 청크명: 조가 숫자(DEC1)면 상위 로마자 장을 접두로(예: [Ⅱ] 1. 평가 정의). */
function hierName(level: HLevel, head: string, chapter: string): string {
  if (level === "DEC1" && chapter) {
    const rc = chapter.match(new RegExp(`[${ROMAN_CHARS}]`))?.[0];
    if (rc) return `[${rc}] ${head}`;
  }
  return head;
}

/** 로마자 헤더 청크명 정리: "Ⅰ ◤ 목 적"·"Ⅰ. 개 요" → "Ⅰ. 목적"(장식 ◤▮ 제거 + 로마자 뒤 점 정규화 + 완전자간 합침).
 *  로마자.숫자(Ⅱ-1)·비로마자 이름은 그대로. */
function cleanRomanName(s: string): string {
  const m = s.match(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ])[\s.◤◥◣◢▮▰▶◀❚‣◦]+([^\d\s].*)$/);
  if (!m) return s;
  let title = m[2].replace(/^[\s.◤◥◣◢▮▰▶◀❚‣◦]+/, "").trim();
  if (/^(?:[가-힣] )+[가-힣]$/.test(title)) title = title.replace(/ /g, ""); // "목 적"→"목적"(완전 자간분리만)
  return `${m[1]}. ${title}`.slice(0, 70);
}
function nameFromArticleHead(line: string): string {
  // 가지번호: 원문이 "제N조의M"·"제N조 M"·"제N조M" 혼재(kordoc가 '의'를 공백/누락) → "제N조의M"로 정규화.
  const m = line.match(/제\s*(\d+)\s*조(?:\s*의?\s*(\d{1,2}))?\s*[(（]\s*((?:[^()（）]|[(（][^()（）]*[)）])*)/);
  if (m) return `제${m[1]}조${m[2] ? `의${m[2]}` : ""}(${m[3].trim()})`;
  const del = line.match(/제\s*(\d+)\s*조(?:\s*의?\s*(\d{1,2}))?\s*삭\s*제/);
  if (del) return `제${del[1]}조${del[2] ? `의${del[2]}` : ""}(삭제)`;
  return line.slice(0, 40).trim();
}

function dropNoise(content: PLine[]): PLine[] {
  const freq = new Map<string, number>();
  for (const l of content) { const t = l.text.trim(); if (t.length >= 6) freq.set(t, (freq.get(t) || 0) + 1); }
  const noisy = (t: string) => {
    if (!t) return false;
    // 반복 줄=노이즈(머리말/꼬리말)지만 정상 절 헤딩(가/나/다 단계별 반복 등)은 보존.
    // 표 행(파이프)은 제외 — 같은 양식의 표를 부서·유형별로 여러 번 싣는 문서에서 공통 행이
    // 5회를 넘어 통째로 지워졌다(내부 성과평가 편람: 지표 행 173개, 헤더행 전멸).
    // 구분행(| --- |)도 함께 살려야 표가 깨지지 않는다.
    if ((freq.get(t) || 0) >= 5 && !classifyHeading(t) && !t.startsWith("|")) return true;
    if (/^#{1,6}\s/.test(t)) return true; // 마크다운 제목 마커(RAG 추출 헤더 '# 정관' 등)
    if (/^(추출기준|페이지표기|정제원칙|표\s*처리|페이지구분|페이지기준|정제기준)\s*[:：]/.test(t)) return true; // RAG 추출 메타데이터
    if (/^(제정|개정|전부개정|일부개정|신설)\s+.*\d{4}/.test(t)) return true; // 제·개정 연혁 행(머리말; 부서-문서번호형 포함)
    if (/[·.\-]{4,}\s*\d{1,4}\s*$/.test(t)) return true; // 목차 점선/대시 리더(…… 페이지번호)
    if (/^[·.\s]{6,}$/.test(t)) return true;
    if (/^\d+\s+(?:제정|개정|신설|일부개정|전부개정)(?=[\s.\d]|$)/.test(t)) return true;
    if (/^\d+\s+\d{4}\s*\.\s*\d{1,2}/.test(t)) return true;
    if (/쪽\s*번\s*호|^\d+\s*\/\s*\d+$/.test(t)) return true;
    return false;
  };
  return content.filter((l) => !noisy(l.text.trim()));
}

// ───────── 부칙·별표·메타메모 분리 ─────────
const BUCHIK_MARKER = /^=+\s*부\s*칙\s*=+\s*$/;
const BUCHIK_HEAD = /^부\s*칙\s*(?:$|[<([（〈《＜]|제\s*\d|\d{4}|[ⅠⅡⅢⅣⅤ])/;
function isBuchikStart(t: string): boolean { return BUCHIK_MARKER.test(t) || BUCHIK_HEAD.test(t); }
function buildBuchik(lines: PLine[]): string {
  const out: string[] = [];
  for (const l of lines) {
    const t = l.text.trim();
    if (!t || BUCHIK_MARKER.test(t)) continue;
    if (/^-\s*\d+\s*-$/.test(t) || /^\d+\s*\/\s*\d+$/.test(t)) continue;
    if (BUCHIK_HEAD.test(t)) { if (out.length) out.push(""); out.push(t); }
    else out.push(t);
  }
  return out.join("\n").trim();
}
const META_MEMO = /^=+\s*(?:참고\s*[(（]?\s*메타|메타\s*메모)/;
const BYULPYO_MARKER = /^=+\s*별\s*표\s*=+\s*$/;
function sectionText(lines: PLine[], dropRe: RegExp): string {
  return lines.filter((l) => !dropRe.test(l.text.trim())).map((l) => l.text).join("\n").trim();
}

// 인라인 별표/별지/서식 머리: "[별표 제1호] 기구표", "(별표 제2호) <개정…>", "별표 제3호"(줄끝).
//  - 괄호형: 닫는 괄호로 경계가 명확해 제목 허용. 무괄호형: 호 직후 종료/개정마커만(조사 회피, 본문 인용 오탐 방지).
// 괄호형(【】〔〕［］()도 포함)·무괄호형 별표/별지 머리. 대시 부번호(별표7-1·13-2호)도 인식.
const BYP_HEAD =
  /^(?:[[(［（〔【]\s*(별표|별지|서식|부표|부록|붙임|양식)\s*제?\s*(\d+)(?:\s*[-의]\s*(\d+))?\s*호?(?:\s*[^\])］）〕】\n]{0,30})?[\])］）〕】]|(별표|별지|서식|부표)\s*제\s*(\d+)\s*호(?:의\s*(\d+))?\s*(?:<|$))/;
const PAGENUM = /^-\s*\d+\s*-$|^\d+\s*\/\s*\d+$/;
// 중첩형 "[별표 제N호(의) 별지 제M호 서식]" — 별표가 자체 별지서식을 거느린 경우(계약업무 처리지침 별표19). 별표 본문·타 별지와 분리.
const BYP_SUB = /^[[(［（〔【]?\s*별표\s*제?\s*(\d+)\s*호\s*의?\s*별지\s*제?\s*(\d+)\s*호?/;
function bypNum(t: string): number {
  const sub = t.match(BYP_SUB);
  if (sub) return Number(sub[1]) * 1000 + 500 + Number(sub[2]); // 별표 N 본문(N*1000)·M별 서식과 모두 구분(병합 방지)
  const m = t.match(BYP_HEAD);
  if (!m) return 0;
  return Number(m[2] ?? m[5] ?? 0) * 1000 + Number(m[3] ?? m[6] ?? 0); // 별표7-1·7-2 구분(부번호 병합 방지)
}
/** 별표 청크명: "별표 제1호 (기구표)". 제목은 머리줄(번호·개정마커 제거 후) 또는 다음 줄에서 추출, 자간분리 복원. */
function bypName(lines: PLine[]): string {
  const head = lines[0].text.trim();
  const sub = head.match(BYP_SUB); // 중첩형 "별표 N호(의) 별지 M호 서식"
  let label: string, rest: string;
  if (sub) {
    label = `별표 제${sub[1]}호 별지 제${sub[2]}호 서식`;
    rest = head.replace(BYP_SUB, "").replace(/^\s*서식\s*[\])］）〕】]?\s*/, "");
  } else {
    const m = head.match(/(별표|별지|서식|부표|부록|붙임|양식)\s*(?:제?\s*(\d+)(?:\s*[-의]\s*(\d+))?\s*호?)?\s*(서식)?/);
    const kind = m?.[1] ?? "별표";
    const no = m?.[2] ? ` 제${m[2]}호${m[3] ? `의${m[3]}` : ""}` : "";
    const suf = m?.[4] ? " 서식" : ""; // "별지 제1호 서식"
    label = `${kind}${no}${suf}`;
    rest = head.replace(/^[[(［（〔【]?\s*(별표|별지|서식|부표|부록|붙임|양식)\s*(?:제?\s*\d+(?:\s*[-의]\s*\d+)?\s*호?)?\s*(서식)?\s*[\])］）〕】]?/, "");
  }
  const clean = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")          // markdown 이미지
      .replace(/<[^>]*>|〈[^〉]*〉/g, "")               // 개정마커 <…> 〈…〉
      .replace(/(전부개정|일부개정|개정|신설|제정)\s*\d[\d.,\s~]*/g, " ") // 무괄호 개정/신설 날짜
      .replace(/[(（][^)）]*관련[)）]/g, "")            // (제N조 관련)
      .replace(/[-–]\s*제\s*\d+\s*조[^\n]*관련/g, "")  // - 제N조 … 관련
      .replace(/^[(（]\s*제\s*\d+\s*조[^)）]*[)）]\s*/, "") // 선두 (제N조) 참조
      .replace(/[\][()（）<>〈〉|＜＞【】]/g, " ")
      .replace(/삭\s*제/g, "삭제")
      .replace(/\s{2,}/g, " ")
      .trim();
  const meaty = (s: string) => s.replace(/[\s,.·]/g, "").length >= 2;
  let title = clean(rest);
  if (!meaty(title)) {
    title = "";
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const c = clean(lines[i].text.trim());
      // 번호목록(1. 2))·순수숫자·조문(제N조)·표행은 제목 아님. 단 "2단계경쟁…"처럼 숫자로 시작하는 진짜 제목은 허용.
      if (meaty(c) && !/^\d+\s*[.)]/.test(c) && !/^\d+\s*$/.test(c) && !/^제\s*\d+\s*조/.test(c) && !lines[i].text.includes("|")) { title = c; break; }
    }
  }
  title = title.slice(0, 40).trim();
  if (/^(\S\s){2,}\S$/.test(title)) title = title.replace(/\s+/g, ""); // "기 구 표" → "기구표"
  return title ? `${label} (${title})` : label;
}
/** 본칙 뒤 꼬리(부칙+별표)를 부칙 1청크 + 별표 N청크로 분리. 별표는 부칙 뒤 표·서식이 흡수되지 않게 개별화. */
function splitTail(lines: PLine[]): { buchik: string; byps: Chunk[] } {
  type Seg = { kind: "buchik" | "byp"; num: number; lines: PLine[] };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  for (const l of lines) {
    const t = l.text.trim();
    if (!t || BUCHIK_MARKER.test(t) || BYULPYO_MARKER.test(t) || PAGENUM.test(t)) continue;
    if (isBuchikStart(t)) {
      if (!cur || cur.kind !== "buchik") { cur = { kind: "buchik", num: 0, lines: [] }; segs.push(cur); }
      cur.lines.push(l);
    } else if (BYP_HEAD.test(t)) {
      const num = bypNum(t);
      if (cur && cur.kind === "byp" && num > 0 && cur.num === num) cur.lines.push(l); // 동일 별표 머리 반복(페이지헤더) → 병합
      else { cur = { kind: "byp", num, lines: [l] }; segs.push(cur); }
    } else if (cur) {
      cur.lines.push(l);
    } else {
      cur = { kind: "buchik", num: 0, lines: [l] }; segs.push(cur);
    }
  }
  const buchik = buildBuchik(segs.filter((s) => s.kind === "buchik").flatMap((s) => s.lines));
  const byps: Chunk[] = segs
    .filter((s) => s.kind === "byp")
    .map((s) => ({ name: bypName(s.lines), fullText: s.lines.map((l) => l.text).join("\n").trim(), order: 0, page: s.lines[0]?.page ?? "", via: "BYP" }));
  return { buchik, byps };
}

function dedupNames(chunks: Chunk[]): Chunk[] {
  const total = new Map<string, number>();
  for (const c of chunks) total.set(c.name, (total.get(c.name) || 0) + 1);
  const seen = new Map<string, number>();
  const used = new Set<string>();   // 최종 이름 유일성 — 하류(그래프 tname·임베딩 재사용)가 이름을 키로 쓴다
  return chunks.map((c) => {
    let name = c.name;
    if ((total.get(c.name) || 0) > 1) {
      const k = (seen.get(c.name) || 0) + 1; seen.set(c.name, k);
      if (k > 1) name = c.page ? `${c.name} (p.${c.page})` : `${c.name} (${k})`;
    }
    // 페이지 접미가 같아 여전히 충돌하면(같은 페이지 중복 — 민법 "제1장 총칙 (p.1)" 실증) 일련번호로 확정
    let final = name, n = 2;
    while (used.has(final)) final = `${name} (${n++})`;
    used.add(final);
    return final === c.name ? c : { ...c, name: final };
  });
}

function chunk(plines: PLine[], pages: number, isReg = false, meta: Meta = {}): { chunks: Chunk[]; via: string } {
  let body = plines.filter((l) => !l.front);
  const mIdx = body.findIndex((l) => META_MEMO.test(l.text.trim()));
  if (mIdx >= 0) body = body.slice(0, mIdx);
  // 구형 정제텍스트의 명시 마커(===별표===)는 단일 별표 섹션으로 보존(레거시).
  const xIdx = body.findIndex((l) => BYULPYO_MARKER.test(l.text.trim()));
  const markerByp = xIdx >= 0 ? sectionText(body.slice(xIdx), BYULPYO_MARKER) : "";
  if (xIdx >= 0) body = body.slice(0, xIdx);
  // 본칙 끝 = 첫 부칙 머리 또는 (마지막 조문 이후의) 첫 별표 머리. 별표 cut은 마지막 조문 뒤로 제한해야
  // 본문 속 "별지 제N호 서식" 참조가 줄머리로 와도 본칙을 자르지 않는다(부칙 없는 부속서류형 대비).
  const JO_LINE = /^제\s*\d+\s*조(?:\s*의?\s*\d+)?\s*(?:[(（]|삭\s*제)/;
  let lastJo = -1;
  for (let i = body.length - 1; i >= 0; i--) { if (JO_LINE.test(body[i].text.trim())) { lastJo = i; break; } }
  // 주의: 부칙 cut에는 lastJo 가드를 걸 수 없다 — 부칙 자신이 조문(제1조(시행일)…)을 품어
  // lastJo가 부칙 내부를 가리키므로, 가드를 걸면 진짜 부칙 머리가 전부 무시돼 부칙이 본칙으로
  // 누수된다(103건 회귀에서 bad 32건 실측). 본문 중간 오인 절단은 audit의 부칙 비대 플래그로 감지한다.
  const bIdx = body.findIndex((l) => isBuchikStart(l.text.trim()));
  const yIdx = body.findIndex((l, i) => { const t = l.text.trim(); return i > lastJo && BYP_HEAD.test(t) && !isBuchikStart(t); });
  const cut = [bIdx, yIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  const mainRaw = cut >= 0 ? body.slice(0, cut) : body;
  const { buchik, byps } = cut >= 0 ? splitTail(body.slice(cut)) : { buchik: "", byps: [] };
  const main = dropNoise(mainRaw);
  // 편람 등 위계형 문서: 프런트매터 노브(청킹깊이=2 → 로마자 장 구분자+숫자 절 경계, 청크상한)로 절 단위 청킹.
  // 규정/세칙/지침은 노브 미기재 → numDepth=99(hd=1)·cap=4000으로 기존 동작 유지(JO 우선).
  const numDepth = Number(meta["청킹깊이"] || meta["청크깊이"]) || 99;
  const cap = Number(meta["청크상한"]) || 4000;
  const sch = meta["청킹"] || "";
  const ganada = /편람가나다/.test(sch); // 편람 숫자.가나다(사원역량) / 로마자.숫자.가나다(내부성과) — 가나다=청킹단위
  const pyeonram = !ganada && /편람/.test(sch); // 전문점: 로마자.숫자.숫자
  const runBon = (sub: PLine[]) => (ganada ? chunkGanada(sub, cap) : pyeonram ? chunkPyeonram(sub, cap) : chunkMain(sub, pages, isReg, true, numDepth, cap));
  // 편람 본편(로마자 위계)+첨부자료(각자 독립 번호체계)가 한 문서에 혼재 → 첨부는 분리 청킹(본편 위계 오염 방지).
  const attAt = (ganada || pyeonram || numDepth < 90) ? main.findIndex((l) => /^첨부자료\s*\d+[.\s]/.test(l.text.trim())) : -1;
  let chunks: Chunk[], via: string;
  if (attAt > 0) {
    const r = runBon(main.slice(0, attAt));
    via = r.via;
    chunks = r.chunks.concat(chunkAttachments(main.slice(attAt), cap)).map((c, i) => ({ ...c, order: i }));
  } else {
    ({ chunks, via } = runBon(main));
  }
  const pageEnd = main[main.length - 1]?.page ?? "";
  if (buchik) chunks.push({ name: "부칙", fullText: buchik, order: chunks.length, page: pageEnd, via: "BUCHIK" }); // 부칙은 1청크(부칙(2)(3) 분할 금지)
  if (ganada && byps.length) chunks.push({ name: "붙임", fullText: "", order: chunks.length, page: pageEnd, via: "JANG" }); // 가나다 편람: 붙임(서식)을 별도 그룹으로
  // 중첩형 별표(별표 N호가 자체 별지서식·붙임을 거느림, 예: 계약업무 처리지침 별표19) 보정:
  //  ① 별표 부속의 붙임은 이름에 '별표 N호' 접두를 붙여 소속 명시(별표·별지 그룹 안에 자연 정렬)
  //  ② 별표 부속(별표 N호 별지/붙임)이 끝나고 본문 최상위 별지(별지 제M호)가 시작되는 첫 지점에 '별지 서식' 구분자 삽입 → 별표19가 본문 별지 1~37을 거느린 듯 보이던 경계 분리.
  let byps2 = byps;
  if (byps.some((b) => /^별표\s*제\d+호\s*별지/.test(b.name))) {
    byps2 = [];
    let inSub = "", split = false;
    for (const b of byps) {
      const sub = b.name.match(/^별표\s*제(\d+)호\s*별지/);
      if (sub) { inSub = sub[1]; byps2.push(b); }
      else if (inSub && /^붙임/.test(b.name)) byps2.push({ ...b, name: `별표 제${inSub}호 ${b.name}` });
      else {
        if (inSub && !split && /^별지\s/.test(b.name)) { byps2.push({ name: "별지 서식", fullText: "", order: 0, page: b.page, via: "JANG" }); split = true; }
        inSub = "";
        byps2.push(b);
      }
    }
  }
  for (const b of byps2) chunks.push({ ...b, order: chunks.length });        // 별표·별지·서식은 각 1청크
  if (markerByp) chunks.push({ name: "별표", fullText: markerByp, order: chunks.length, page: pageEnd, via: "BYP" });
  return { chunks: dedupNames(chunks), via };
}

/** 부속 제목 자간 정리 — 제목 전체가 '음절+공백'(완전 자간 분리)일 때만 합친다(예: "수 수 료 율 표"→"수수료율표", "각 서"→"각서").
 *  부분 띄어쓰기(및·등 단음절 단어 포함)는 정상 띄어쓰기일 수 있어 건드리지 않음. */
function despaceTitle(t: string): string {
  const s = t.trim();
  return /^(?:[가-힣] )+[가-힣]$/.test(s) ? s.replace(/ /g, "") : s;
}

/** 계약서 부속 청크명 — "(양식2)"·"(별표1)" 헤더에서 종류·번호+제목 추출(제목 없으면 다음 줄 보충, 자간 정리). */
function attachName(lines: PLine[]): string {
  const head = lines[0].text.trim();
  const m = head.match(/^[[(［（〔〈]\s*(양식|별표|별지|서식|부표|부록|붙임)\s*제?\s*(\d+)(?:\s*[-의]\s*(\d+))?\s*호?\s*[\])］）〕〉]\s*(.*)$/);
  if (!m) return head.slice(0, 60);
  const num = m[2] + (m[3] ? `-${m[3]}` : "");
  let title = (m[4] || "").trim();
  if (!title) { const nx = lines.slice(1).map((l) => l.text.trim()).find(Boolean) ?? ""; if (nx && !ATTACH_HEAD.test(nx)) title = nx.slice(0, 40); }
  title = despaceTitle(title);
  return `${m[1]}${num}${title ? ` ${title}` : ""}`.slice(0, 60);
}

/**
 * 계약서 전용 청킹 — 표지(보존) + 본문(JO+장, 「【제N조】」 정규화) + 부속(별표·양식 각 1청크 + "부속서류" 그룹).
 * 부속 항목은 내부에 자체 조가 있어도 통째 1청크(개별 단위 유지).
 */
function chunkContract(plines: PLine[], pages: number): { chunks: Chunk[]; via: string } {
  const lines = plines.map((l) => ({ ...l, text: l.text.replace(CONTRACT_BRACKET_JO, "$1") }));
  const isMainHead = (t: string) => /^제\s*\d+\s*장/.test(t) || /^제\s*\d+\s*조/.test(t);
  const mainStart = lines.findIndex((l) => isMainHead(l.text.trim()));
  if (mainStart < 0) return chunk(plines, pages, false); // 조/장 없음 → 일반 폴백

  // 표지 끝 = 본문 마커 앞. 단, 표지 영역에 (양식1) 등 부속 헤더가 있으면 그것을 표지/본문 구분자로 삼아
  //   표지는 그 앞까지만(헤더~본문은 chunkMain preamble로 흡수 → 표지엔 미포함, 부속은 그 다음 헤더부터).
  let coverEnd = mainStart;
  for (let i = 0; i < mainStart; i++) { if (ATTACH_HEAD.test(lines[i].text.trim())) { coverEnd = i; break; } }

  let attachStart = -1;
  for (let i = mainStart + 1; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (ATTACH_HEAD.test(t) || isBuchikStart(t)) { attachStart = i; break; }
  }
  const mainEnd = attachStart < 0 ? lines.length : attachStart;
  const chunks: Chunk[] = [];

  // 표지(보존) — 구분자(양식1 등) 앞까지
  const cover = lines.slice(0, coverEnd).filter((l) => l.text.trim());
  if (cover.length && stripWs(cover.map((l) => l.text).join("")).length >= 20) {
    chunks.push({ name: "표지", fullText: cover.map((l) => l.text).join("\n").trim(), order: chunks.length, page: cover[0].page, via: "COVER" });
  }
  // 본문(JO + 장 구분자) — coverEnd부터(양식1 헤더는 preamble로 chunkMain이 흡수/제외)
  for (const c of chunkMain(lines.slice(coverEnd, mainEnd), pages, true).chunks) chunks.push({ ...c, order: chunks.length });

  // 부속서류 — 연속 중복 헤더 제거 후 별표·양식 각 1청크 + 그룹 구분자
  if (attachStart >= 0) {
    const at0 = lines.slice(attachStart);
    const at: PLine[] = [];
    for (let i = 0; i < at0.length; i++) {
      const t = at0[i].text.trim();
      if (ATTACH_HEAD.test(t)) {
        const nx = at0.slice(i + 1).find((l) => l.text.trim()); // 다음 비어있지 않은 줄
        if (nx && ATTACH_HEAD.test(nx.text.trim()) && attachName([at0[i]]) === attachName([nx])) continue; // 같은 번호 연속 중복 헤더 제거
      }
      at.push(at0[i]);
    }
    const heads: number[] = [];
    at.forEach((l, i) => { const t = l.text.trim(); if (ATTACH_HEAD.test(t) || isBuchikStart(t)) heads.push(i); });
    if (heads.length) {
      chunks.push({ name: "부속서류", fullText: "", order: chunks.length, page: at[0].page, via: "ATTACH_HDR" }); // 그룹 구분자(빈 body)
      for (let k = 0; k < heads.length; k++) {
        const s = heads[k], e = k + 1 < heads.length ? heads[k + 1] : at.length;
        const seg = at.slice(s, e);
        const buchik = isBuchikStart(seg[0].text.trim());
        chunks.push({ name: buchik ? "부칙" : attachName(seg), fullText: seg.map((l) => l.text).join("\n").trim(), order: chunks.length, page: seg[0].page, via: buchik ? "BUCHIK" : "BYP" });
      }
    }
  }
  return { chunks: dedupNames(chunks), via: "CONTRACT" };
}

// 매뉴얼 부속 헤더(라인 시작): "별지 3 : …", "양식 2 …", "[붙임1] …", "별표 1 …", "<별첨 : …>" 등.
//  계약서 ATTACH_HEAD보다 느슨(콜론·꺾쇠·무번호 허용 — 별첨/붙임은 번호 없는 경우가 흔함).
const MANUAL_ATTACH_HEAD =
  /^[[(［（〔〈<]?\s*(별\s*지\s*서\s*식|별\s*지|별\s*표|양\s*식|서\s*식|붙\s*임|부\s*록|부\s*표|별\s*첨)\s*(?:제?\s*\d+(?:\s*[-의]\s*\d+)?\s*호?\.?)?\s*(?:[\])］）〕〉>]|[:：)]|\s|$)/;
// 표지·이력의 날짜줄("2013.05.01 개정", "2026. 03.")이 숫자 헤딩(DEC)으로 오분류되는 것을 차단(연.월 형태만).
const DATE_LINE = /^\s*\d{4}\s*[.\-]\s*\d{1,2}/;

/** 매뉴얼 부속 청크명 — "별지 3 광고 신청서". 종류·번호+제목(없으면 다음 줄 보충, 자간 정리). */
function manualAttachName(lines: PLine[]): string {
  const head = lines[0].text.trim();
  const m = head.match(/^[[(［（〔〈<]?\s*(별\s*지\s*서\s*식|별\s*지|별\s*표|양\s*식|서\s*식|붙\s*임|부\s*록|부\s*표|별\s*첨)\s*(?:제?\s*(\d+)(?:\s*[-의]\s*(\d+))?\s*호?\.?)?\s*[\])］）〕〉>]?\s*[:：)]?\s*(.*)$/);
  if (!m) return head.slice(0, 60);
  const kind = m[1].replace(/\s/g, "");
  const num = m[2] ? ` ${m[2]}${m[3] ? `-${m[3]}` : ""}` : "";
  let title = (m[4] || "").trim().replace(/^[.\s]+/, "").replace(/[>\])］）〕〉]+\s*$/, "");
  if (!title) { const nx = lines.slice(1).map((l) => l.text.trim()).find(Boolean) ?? ""; if (nx && !MANUAL_ATTACH_HEAD.test(nx)) title = nx.slice(0, 40); }
  title = despaceTitle(title);
  return `${kind}${num}${title ? ` ${title}` : ""}`.slice(0, 60);
}

/**
 * 매뉴얼 전용 청킹 — 5구성요소(표지·제개정이력·목차·본문·부속서류) 인식.
 *  1) 프런트매터 `청킹: 페이지` → 페이지단위(매장서비스 등 스캔본; 페이지·제목·내용).
 *  2) 부속서류(별지/양식/별표/서식/붙임/별첨)를 본문 시작 이후 첫 부속 헤더부터 격리 → 각 1청크 + "부속서류" 구분자.
 *     임베드된 양식·규정의 조(條)가 본문에서 빠지고, 본문 청킹은 JO 비활성(매뉴얼 본문은 로마자/숫자 위계뿐).
 *  3) 표지·제개정이력·목차(본문 첫 '내용 있는' 헤딩 전)는 색인 제외 — 날짜·목차헤딩 오인 방지.
 *  4) 본문은 chunkMain(로마자/숫자 위계, 크기 정규화)로 적응 선택(지능형 깊이).
 */
function chunkManual(plines: PLine[], pages: number, meta: Meta): { chunks: Chunk[]; via: string } {
  const strat = (meta["청킹"] || meta["청킹전략"] || meta["chunk"] || "").trim();
  if (/페이지|page/i.test(strat)) {
    return { chunks: dedupNames(sizeCap(byPage(plines.filter((l) => l.text.trim())), plines)), via: "PAGE" };
  }

  let work = plines.filter((l) => !l.front);
  const mIdx = work.findIndex((l) => META_MEMO.test(l.text.trim()));
  if (mIdx >= 0) work = work.slice(0, mIdx);

  // 본문 헤딩 = 로마자/숫자/장(날짜·목차 제외). 조(條)는 매뉴얼 본문에 없고 부속(양식·예시)에만 나오므로 제외.
  const isBodyHead = (t: string) => {
    if (TOC_LINE.test(t) || DATE_LINE.test(t)) return false;
    const c = classifyHeading(t);
    return c === "ROMAN" || c === "ROMANNUM" || c === "DECN" || c === "DEC1" || c === "JANG";
  };

  // 부속 시작 = 본문 첫 헤딩 이후 첫 부속/부칙 헤더(라인시작·목차行 제외)
  const firstHead = Math.max(0, work.findIndex((l) => isBodyHead(l.text.trim())));
  let attachStart = -1;
  for (let i = firstHead + 1; i < work.length; i++) {
    const t = work[i].text.trim();
    if ((MANUAL_ATTACH_HEAD.test(t) || isBuchikStart(t)) && !TOC_LINE.test(t)) { attachStart = i; break; }
  }
  const mainPart = attachStart >= 0 ? work.slice(0, attachStart) : work;
  const attachPart = attachStart >= 0 ? work.slice(attachStart) : [];

  // front(표지·이력·목차) 제외: 첫 '내용(한글 문장) 있는' 헤딩의 블록 시작까지 버린다.
  //  목차는 헤딩만 나열(내용 없음)·표지는 날짜뿐이라 자연히 건너뛴다. 상위 장 헤더는 직전 근접 헤딩으로 흡수.
  const heads: number[] = [];
  mainPart.forEach((l, i) => { if (isBodyHead(l.text.trim())) heads.push(i); });
  const segHasContent = (a: number, b: number) =>
    mainPart.slice(a + 1, b).some((l) => { const t = l.text.trim(); return t.length >= 16 && !isBodyHead(t) && !TOC_LINE.test(t) && /[가-힣]/.test(t); });
  let bodyStart = 0;
  for (let k = 0; k < heads.length; k++) {
    const e = k + 1 < heads.length ? heads[k + 1] : mainPart.length;
    if (!segHasContent(heads[k], e)) continue;
    let b = k;
    while (b > 0 && heads[b] - heads[b - 1] <= 4 && !segHasContent(heads[b - 1], heads[b])) b--;
    bodyStart = heads[b];
    break;
  }
  const main = dropNoise(mainPart.slice(bodyStart));

  const chunks: Chunk[] = [];
  let via = "PAGE";
  if (main.length) {
    const numDepth = Number(meta["청킹깊이"] || meta["청크깊이"]) || 99; // 프런트매터로 십진 청킹 깊이 제어(2=N.N까지)
    const cap = Number(meta["청크상한"]) || 4000; // 응집 섹션(개요+용어정의 등) 보존이 필요한 문서만 프런트매터로 상향
    const boxSub = /로마.*박스|박스절/.test(strat); // 로마자(장)+□(절) 모드(성희롱 등): 본문이 번호 대신 □ 사용
    const r = chunkMain(main, pages, false, false, numDepth, cap, boxSub); // allowJo=false: 매뉴얼 본문은 조(條) 구조 아님
    via = r.via;
    for (const c of r.chunks) chunks.push({ ...c, order: chunks.length });
  }

  // 부속서류 — 각 별지/양식/별표 1청크 + 그룹 구분자(빈 body). 인접 헤더(사이 내용 없음)는 병합.
  if (attachPart.length) {
    let heads2: number[] = [];
    attachPart.forEach((l, i) => { const t = l.text.trim(); if (MANUAL_ATTACH_HEAD.test(t) || isBuchikStart(t)) heads2.push(i); });
    heads2 = heads2.filter((h, k) => k === 0 || attachPart.slice(heads2[k - 1] + 1, h).some((l) => { const t = l.text.trim(); return t.length >= 16 && !MANUAL_ATTACH_HEAD.test(t); }));
    if (heads2.length) {
      chunks.push({ name: "부속서류", fullText: "", order: chunks.length, page: attachPart[heads2[0]].page, via: "ATTACH_HDR" });
      for (let k = 0; k < heads2.length; k++) {
        const s = heads2[k], e = k + 1 < heads2.length ? heads2[k + 1] : attachPart.length;
        const seg = attachPart.slice(s, e).filter((l) => l.text.trim());
        if (!seg.length) continue;
        const buchik = isBuchikStart(seg[0].text.trim());
        const text = seg.map((l) => l.text).join("\n").trim();
        // "붙임 : 1. … N부" 식 콜론+번호목록 푸터(별지 양식 첨부 안내)만 직전 부속에 흡수.
        //  "붙임N 제목"(번호 직결 = 노출점검보고서 등 실제 부속 섹션)은 분리 유지.
        const prev = chunks[chunks.length - 1];
        const isFooterNote = nzChars(text) < 200 && /^[[(<]?\s*(?:붙\s*임|별\s*첨)\s*(?:서\s*류)?\s*[:：]/.test(seg[0].text.trim());
        if (!buchik && prev && prev.via === "BYP" && isFooterNote) {
          prev.fullText = `${prev.fullText}\n${text}`.trim();
          continue;
        }
        chunks.push({ name: buchik ? "부칙" : manualAttachName(seg), fullText: text, order: chunks.length, page: seg[0].page, via: buchik ? "BUCHIK" : "BYP" });
      }
    }
  }
  return { chunks: dedupNames(chunks), via: chunks.length ? via : "PAGE" };
}

/** 십진 헤딩 깊이(점 개수+1). "6"→1, "6.1"→2, "6.1.2"→3. */
function decDepth(t: string): number { const m = t.match(/^(\d+(?:\.\d+)*)/); return m ? m[1].split(".").length : 99; }
function chunkMain(content: PLine[], pages: number, isReg = false, allowJo = true, numDepth = 99, cap = 4000, boxSub = false): { chunks: Chunk[]; via: string } {
  const joined = content.map((l) => l.text).join("\n");

  const joCount = (joined.match(/제\s*\d+\s*조\s*[(（]/g) || []).length;
  if (allowJo && joCount >= 5 && joCount >= pages * 0.3) {
    const secs = joined.split(JE_SPLIT).map((s) => s.trim()).filter(Boolean);
    const chunks: Chunk[] = [];
    let order = 0;
    // 장(章): JE_SPLIT가 '제N장' 헤더 줄을 앞 조 끝에 붙이므로, 본문 끝의 장 헤더를 떼어 두었다가
    // 다음 조 앞에 '별도 장 청크(빈 body=구분자)'로 삽입한다. 표시 목록에서 조들의 상위 그룹이 된다.
    let pending: { name: string; page: string }[] = [];
    const flushChapter = () => { for (const p of pending) chunks.push({ name: p.name, fullText: "", order: order++, page: p.page, via: "JANG" }); pending = []; };
    const peelChapter = (text: string, page: string): string => {
      // 섹션 끝에서 빈 줄·절(제N절)·개정주석을 건너뛰며 장(제N장) 헤더를 탐색 → 찾으면 그 위치부터 잘라 다음 조 앞 구분자로.
      // 연속 스택 장(삭제장 등 빈 장 여러 개)도 모두 떼어 누락 방지. 비파괴: 장을 못 찾으면 원문 그대로(끝 주석·절을 함부로 버리지 않음).
      const lines = text.split("\n");
      let i = lines.length - 1, cut = -1;
      const found: { name: string; page: string }[] = [];
      while (i >= 0) {
        const t = lines[i].trim();
        if (t === "" || SECTION_HEAD.test(t) || isAmendNote(t)) { i--; continue; }
        if (CHAPTER.test(t)) { found.push({ name: t.slice(0, 60), page }); cut = i; i--; continue; }
        break; // 실제 본문 도달 → 장 헤더 없음
      }
      if (cut >= 0) { pending.push(...found.reverse()); return lines.slice(0, cut).join("\n").trim(); }
      return lines.join("\n").trim();
    };
    for (const sec of secs) {
      const m = sec.match(HEAD_TOKEN);
      if (!m) {
        // 규정·세칙·지침은 제1조 이전이 항상 머리(연혁·고지)라 머리말 미생성. 매뉴얼 등은 실내용일 수 있어 보존.
        const pg = content[0]?.page ?? "1";
        const txt = peelChapter(sec, pg); // 머리말 끝의 제1장 헤더 분리(다음 조 앞에 삽입)
        if (order === 0 && !isReg && stripWs(txt).length >= 60) chunks.push({ name: `[머리말] ${txt.split("\n")[0].trim().slice(0, 30)}`, fullText: txt, order: order++, page: pg, via: "JO" });
        continue;
      }
      flushChapter(); // 직전 조에서 떼어낸 장 헤더를 이 조 앞에 삽입
      const pg = pageOf(content, sec);
      const body = peelChapter(sec.slice(m[0].length).replace(/^[ \t·.]+/, "").trim(), pg);
      chunks.push({ name: nameFromArticleHead(m[0]), fullText: body, order: order++, page: pg, via: "JO" });
    }
    flushChapter(); // 마지막에 남은 장 헤더(있으면)
    if (chunks.length >= 5) return { chunks: sizeCap(chunks, content, 15000), via: "JO" }; // 조는 통째로(큰 정의조 등 분할 방지)
  }

  // ── 로마자(장) + □(절) 위계: 본문이 번호 대신 네모박스블릿(□)으로 절을 구분하는 매뉴얼(성희롱 등).
  //    목차는 로마자.숫자(Ⅱ.1…)지만 본문은 "Ⅱ ◤ …" + "□ 소제목" 구조 → 절명을 "로마자.N"으로 부여. ──
  if (boxSub) {
    const romanIdx: number[] = [];
    content.forEach((l, i) => { const c = classifyHeading(l.text.trim()); if ((c === "ROMAN" || c === "ROMANNUM") && !TOC_LINE.test(l.text.trim())) romanIdx.push(i); });
    if (romanIdx.length >= 3) {
      const chunks: Chunk[] = [];
      if (romanIdx[0] > 0) for (const pc of byPage(content.slice(0, romanIdx[0]))) chunks.push({ ...pc, via: "ROMANBOX" });
      for (let k = 0; k < romanIdx.length; k++) {
        const s = romanIdx[k], e = k + 1 < romanIdx.length ? romanIdx[k + 1] : content.length;
        const head = content[s].text.trim();
        const rc = (head.match(new RegExp(`[${ROMAN_CHARS}]`)) || [])[0] || "";
        const sec = content.slice(s + 1, e);
        const boxIdx: number[] = [];
        sec.forEach((l, ii) => { if (/^□/.test(l.text.trim())) boxIdx.push(ii); });
        if (boxIdx.length >= 2) { // 절이 여럿 → 장은 구분자(빈 body), 각 □ = "로마자.N 제목"
          chunks.push({ name: head.slice(0, 70), fullText: "", order: chunks.length, page: content[s].page, via: "JANG" });
          for (let b = 0; b < boxIdx.length; b++) {
            const bs = boxIdx[b], be = b + 1 < boxIdx.length ? boxIdx[b + 1] : sec.length;
            const title = sec[bs].text.trim().replace(/^□\s*/, "").trim();
            let body = sec.slice(bs + 1, be).map((l) => l.text).join("\n").trim();
            if (!body) body = title; // 단일행 □절(내용이 □줄에 있음) → body 보존(빈 구분자 오인식 방지)
            chunks.push({ name: `${rc}.${b + 1} ${title}`.slice(0, 70), fullText: body, order: chunks.length, page: sec[bs].page, via: "ROMANBOX" });
          }
        } else { // 절 0~1개(목차에 하위번호 없음, 예 Ⅰ.목적) → 장 자체가 1청크
          chunks.push({ name: head.slice(0, 70), fullText: sec.map((l) => l.text).join("\n").trim(), order: chunks.length, page: content[s].page, via: "ROMANBOX" });
        }
      }
      return { chunks: sizeCap(chunks, content, cap), via: "ROMANBOX" };
    }
  }

  // ── 위계형(편람 등): 로마자(장) > 로마자.숫자/숫자(조) > 가나다/항. 위계 프로파일 후 조 레벨 적응 선택 ──
  const cls = content.map((l) => classifyHeading(l.text.trim()));
  const toc = content.map((l) => TOC_LINE.test(l.text.trim()));
  const cnt = (h: HLevel) => cls.filter((x, i) => x === h && !toc[i]).length;
  const romanTotal = cnt("ROMAN") + cnt("ROMANNUM");
  if (romanTotal >= 3) {
    // 경계 깊이: 기본 1=로마자(장)만(과편화 방지, 대형 장은 sizeCap 분할). numDepth 지정 시 2=+숫자, 3=+가나다.
    const hd = numDepth >= 1 && numDepth <= 3 ? numDepth : 1;
    const isBoundary = (i: number) => {
      if (toc[i]) return false;
      const c = cls[i]; const t = content[i].text.trim();
      if (c === "ROMAN" || c === "ROMANNUM") return true;
      if (hd >= 2 && (c === "DECN" || (c === "DEC1" && /^\d+\.\s/.test(t)))) return true; // "N." 절은 경계, "N)" 목록항목은 제외
      if (hd >= 3 && c === "GANADA" && /^[가-힣]\.\s/.test(t)) return true;                // "가." 항은 경계, "가)" 제외
      return false;
    };
    const idx: number[] = [];
    content.forEach((_, i) => { if (isBoundary(i)) idx.push(i); });
    if (idx.length >= 4) {
      const chunks: Chunk[] = [];
      if (idx[0] > 0) for (const pc of byPage(content.slice(0, idx[0]))) chunks.push({ ...pc, via: "HIER" });
      let chapter = "", roman = "", dec = "", decTitle = "";
      for (let k = 0; k < idx.length; k++) {
        const s = idx[k], e = k + 1 < idx.length ? idx[k + 1] : content.length;
        const head = content[s].text.trim();
        const c = cls[s];
        const rc = (head.match(new RegExp(`[${ROMAN_CHARS}]`)) || [])[0] || "";
        const body = content.slice(s + 1, e).map((l) => l.text).join("\n").trim();
        if (c === "ROMAN") {
          chapter = head; roman = rc; dec = "";
          if (hd >= 2) { // 깊이2/3: 로마자 장은 구분자(빈 body 그룹 라벨), 장 직속 머리내용은 별도 청크
            chunks.push({ name: head.slice(0, 70), fullText: "", order: chunks.length, page: content[s].page, via: "JANG" });
            if (body.length >= 50) chunks.push({ name: `[${rc}] 개요`.slice(0, 70), fullText: body, order: chunks.length, page: content[s].page, via: "HIER" }); // 짧은 머리(개요 헤더 조각)는 생략
            continue;
          }
        } else if (c === "DEC1" || c === "DECN") { dec = (head.match(/^\d+(?:\.\d+)*/) || [])[0] || ""; decTitle = head.slice(dec.length).replace(/^[.)\s]+/, "").trim(); } // 다단계 십진(1.1) 전체 보존 → "Ⅰ.1.1 정의"
        // 깊이2/3: 하위 헤딩에 "로마자.숫자[ 절제목]" 접두로 위계 맥락 부여(가나다 항 중복 구분, 단계명 노출)
        let name = hierName(c, head, chapter);
        if (hd >= 2 && (c === "DEC1" || c === "DECN") && roman) name = `${roman}.${dec} ${decTitle}`.trim(); // Ⅰ.1 목적
        else if (hd >= 3 && c === "GANADA" && roman) name = `${roman}.${dec}${decTitle ? " " + decTitle : ""} ${head}`.trim(); // Ⅲ.1 관심 가. 상황
        chunks.push({ name: name.slice(0, 70), fullText: hd >= 2 ? body : body || head, order: chunks.length, page: content[s].page, via: "HIER" });
      }
      if (hd === 1) return { chunks: sizeCap(chunks, content, cap), via: "HIER" }; // 기본(로마자만): 기존 동작 유지
      // 깊이2/3: 빈 절 헤더 제거(하위 항목명에 접두로 맥락 유지) + 작은 항 병합(로마자 구분자·로마자/숫자 절은 보호)
      const isTop = (c: Chunk) => c.via === "JANG" || /^(\[[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]\]\s|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]\s*[.\s])/.test(c.name);
      const nonEmpty = chunks.filter((c) => c.fullText.trim() || c.via === "JANG");
      return { chunks: sizeCap(mergeSmall(nonEmpty, 200, isTop), content, cap), via: "HIER" };
    }
  }

  // 십진 위계. numDepth 지정 시 그 깊이까지만 경계로(예: 2 → N.·N.N만, N.N.N은 상위 청크 내용으로 롤업).
  const limited = numDepth < 90;
  // 깊이제한 시 최상위 "N."이 장(章)인지 절 내부 목록항목인지 판별: 본문 "N." 번호 수열이 단조증가(비감소)면
  // 장(부패방지·안전보건 1·2·…·10), 리셋(1,2,3,1,2…)이면 목록항목(비연고지 1.2 용어정의 하위 등) → N.은 경계 제외, N.N만.
  let bareIsChapter = true;
  if (limited) {
    const topNs: number[] = [];
    content.forEach((l) => { const t = l.text.trim(); if (DEC_HEAD.test(t) && !TOC_LINE.test(t) && decDepth(t) === 1) topNs.push(+t.match(/^(\d+)/)![1]); });
    bareIsChapter = topNs.length === 0 || topNs.every((n, i) => i === 0 || n >= topNs[i - 1]);
  }
  // 장 헤더 판별: bare "N."이 바로 다음 십진헤딩 "N.M"(같은 N)을 거느리면 장(구분자). 본문 목록항목("1. 회사부담"…)과 구분.
  const isChapterHead = (i: number): boolean => {
    const n = (content[i].text.trim().match(/^(\d+)/) || [])[1];
    if (!n) return false;
    for (let j = i + 1; j < content.length; j++) {
      const tj = content[j].text.trim();
      if (!DEC_HEAD.test(tj) || TOC_LINE.test(tj)) continue;
      return decDepth(tj) >= 2 && tj.startsWith(n + ".");
    }
    return false;
  };
  const decIdx: number[] = [];
  content.forEach((l, i) => {
    const t = l.text.trim();
    if (!DEC_HEAD.test(t) || TOC_LINE.test(t) || decDepth(t) > numDepth) return;
    if (limited && decDepth(t) === 1 && !bareIsChapter && !isChapterHead(i)) return; // 장(N.M 거느림)·단조 leaf만 경계, 목록항목 N. 배제
    decIdx.push(i);
  });
  if (decIdx.length >= 5 && decIdx[0] <= content.length * 0.4) {
    const chunks: Chunk[] = [];
    if (decIdx[0] > 0) for (const pc of byPage(content.slice(0, decIdx[0]))) chunks.push({ ...pc, via: "NUM" });
    let pendingIntro = "";
    for (let k = 0; k < decIdx.length; k++) {
      const s = decIdx[k], e = k + 1 < decIdx.length ? decIdx[k + 1] : content.length;
      const head = content[s].text.trim();
      let text = content.slice(s + 1, e).map((l) => l.text).join("\n").trim();
      if (limited && decDepth(head) === 1 && (bareIsChapter || isChapterHead(s))) { // 모든 장 → 구분자(그룹 라벨)
        chunks.push({ name: head.slice(0, 60), fullText: "", order: chunks.length, page: content[s].page, via: "JANG" });
        if (isChapterHead(s)) pendingIntro = text; // 하위절 보유 장: 머리내용은 첫 절에 병합(별도 개요청크 미생성)
        else if (stripWs(text).length >= 5) chunks.push({ name: `[${(head.match(/^\d+/) || [])[0]}] 본문`.slice(0, 60), fullText: text, order: chunks.length, page: content[s].page, via: "NUM" }); // leaf장: 내용 청크
        continue;
      }
      if (!text) { const tail = head.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim(); if (tail) text = tail; } // 단일행 절: 내용이 제목줄 → body 보존
      if (pendingIntro) { text = `${pendingIntro}\n${text}`.trim(); pendingIntro = ""; } // 장 머리내용을 첫 절에 병합
      chunks.push({ name: head.slice(0, 60), fullText: text, order: chunks.length, page: content[s].page, via: "NUM" });
    }
    // 깊이 지정 시: 각 절을 개별 청크로 보존(용어정의도 개별칩). 장 구분자(via JANG)는 빈 body로 보존.
    if (limited) return { chunks: sizeCap(chunks.filter((c) => c.fullText.trim() || c.via === "JANG"), content, cap), via: "NUM" };
    return { chunks: sizeCap(mergeSmall(chunks, 250), content, cap), via: "NUM" };
  }

  const jangIdx: number[] = [];
  content.forEach((l, i) => { if (JANG.test(l.text.trim())) jangIdx.push(i); });
  if (jangIdx.length >= 3) {
    const chunks: Chunk[] = [];
    for (let k = 0; k < jangIdx.length; k++) {
      const s = jangIdx[k], e = k + 1 < jangIdx.length ? jangIdx[k + 1] : content.length;
      chunks.push({ name: content[s].text.trim().slice(0, 60), fullText: content.slice(s + 1, e).map((l) => l.text).join("\n").trim(), order: k, page: content[s].page, via: "JANG" });
    }
    return { chunks: sizeCap(chunks, content, cap), via: "JANG" };
  }

  return { chunks: sizeCap(byPage(content), content, cap), via: "PAGE" };
}

function pageOf(content: PLine[], sec: string): string {
  const head = sec.split("\n")[0].trim();
  const hit = content.find((l) => l.text.trim() === head);
  return hit ? hit.page : (content[0]?.page ?? "1");
}
function byPage(content: PLine[]): Chunk[] {
  const map = new Map<string, string[]>();
  for (const l of content) { if (!map.has(l.page)) map.set(l.page, []); map.get(l.page)!.push(l.text); }
  const chunks: Chunk[] = [];
  let order = 0;
  for (const [page, arr] of map) {
    const text = arr.join("\n").trim();
    if (!text) continue;
    const firstHead = arr.map((s) => s.trim()).find((s) => s.length > 0) ?? `p.${page}`;
    chunks.push({ name: `[p.${page}] ${firstHead.slice(0, 40)}`, fullText: text, order: order++, page, via: "PAGE" });
  }
  return chunks;
}
/** DEC1 "n."이 실제 절인지 — 같은 절의 하위 "n.M"이 (다음 로마자/다른 DEC1 전에) 나오면 절(자식 보유).
 *  평가기준표 가감점 각주(1.~10.)·예시 공문 번호는 자식이 없어 절로 오인되지 않음. */
function hasChildSection(content: PLine[], cls: HLevel[], toc: boolean[], i: number, n: number): boolean {
  for (let j = i + 1; j < content.length; j++) {
    if (toc[j]) continue;
    const cj = cls[j], tj = content[j].text.trim();
    if (cj === "ROMAN" || cj === "ROMANNUM") return false;
    if (cj === "DECN") { const mj = tj.match(/^(\d+)\.\d/); return !!mj && +mj[1] === n; }
    if (cj === "DEC1") { const mj = tj.match(/^(\d+)/); if (mj && +mj[1] !== n) return false; }
  }
  return false;
}
/** 편람 3단계 청킹(프런트매터 `청킹: 편람`): 로마자=그룹 구분자 / 로마자.숫자=절(제목+▣참조) / 로마자.숫자.숫자=청킹단위.
 *  절 안 예시·표상자의 번호(1. 2. 가.·연도)·리셋은 단조증가+범위 보호로 본문 유지 → 표상자가 청크를 깨지 않음. ▣참조줄은 다음 절 머리에 부착. */
function chunkPyeonram(content: PLine[], cap: number): { chunks: Chunk[]; via: string } {
  const cls = content.map((l) => classifyHeading(l.text.trim()));
  const toc = content.map((l) => TOC_LINE.test(l.text.trim()));
  const romanOf = (t: string) => (t.match(new RegExp(`[${ROMAN_CHARS}]`)) || [])[0] || "";
  const chunks: Chunk[] = [];
  let firstRoman = content.findIndex((l, i) => (cls[i] === "ROMAN" || cls[i] === "ROMANNUM") && !toc[i]);
  if (firstRoman < 0) firstRoman = 0;
  if (firstRoman > 0) for (const pc of byPage(content.slice(0, firstRoman))) chunks.push({ ...pc, order: chunks.length }); // 머리말(표지·일러두기)
  let roman = "", dec1 = 0, dec2 = 0, curName = "", curPage = content[firstRoman]?.page ?? "1";
  let buf: string[] = [], pendingRef: string[] = [];
  const flush = () => { if (curName) chunks.push({ name: curName.slice(0, 70), fullText: buf.join("\n").trim(), order: chunks.length, page: curPage, via: "HIER" }); buf = []; };
  for (let i = firstRoman; i < content.length; i++) {
    const raw = content[i].text, t = raw.trim(), c = cls[i];
    if (/^▣\s*관련\s*(?:지침|계약서)\s*조문/.test(t)) { pendingRef.push(raw); continue; } // 참조 → 다음 절 머리 부착
    if (!toc[i]) {
      if (c === "ROMAN" || c === "ROMANNUM") { // 장 = 그룹 구분자
        flush(); chunks.push({ name: t.slice(0, 70), fullText: "", order: chunks.length, page: content[i].page, via: "JANG" });
        roman = romanOf(t); dec1 = 0; dec2 = 0; curName = ""; buf = []; curPage = content[i].page; continue;
      }
      if (c === "DEC1") { // 절(로마자.숫자) = 제목+참조. 단조증가·범위(<100)·자식(n.M)보유 절만 — 각주(평가기준표 1.~10.)·예시·연도 배제
        const m = t.match(/^(\d+)[.)]\s+(\S.*)$/);
        const n = m ? +m[1] : 0;
        if (m && n > dec1 && n < 100 && hasChildSection(content, cls, toc, i, n)) {
          flush(); dec1 = n; dec2 = 0; curName = `${roman}.${dec1} ${m[2].trim()}`; curPage = content[i].page;
          buf = pendingRef.length ? [...pendingRef, ""] : []; pendingRef = []; continue;
        }
      }
      if (c === "DECN") { // 청킹단위(로마자.숫자.숫자) = 현재 절의 하위·단조증가만(예시 리셋 N.M 배제)
        const m = t.match(/^(\d+)\.(\d+)(?:\s+(\S.*))?$/);
        if (m && +m[1] === dec1 && +m[2] > dec2) {
          flush(); dec2 = +m[2]; curName = `${roman}.${dec1}.${dec2}${m[3] ? " " + m[3].trim() : ""}`; curPage = content[i].page; buf = []; continue;
        }
      }
    }
    buf.push(raw); // 그 외(○·-·※ 들여쓰기, 예시·표상자, 가.목 등)는 현재 청크 본문
  }
  flush();
  return { chunks: sizeCap(chunks, content, cap), via: "HIER" };
}
/** 첨부 페이지 청크명 — 첫 헤딩성 줄(로마자/숫자/별표·별지·서식·참고/□/◦)로, 없으면 첫 줄. */
function attHeadName(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const isHead = (t: string) => /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.\s]|\d+\.\s|[[#]?\s*(?:별표|별지|서식|참고|붙임|별첨)|[□■▣]|◦)/.test(t);
  const h = (lines.find(isHead) || lines[0] || "").replace(/^[#\\[\]]+/, "").replace(/<br>/g, " ").trim();
  return h.slice(0, 48);
}
const PYEONRAM_BU = /^\\?[#"'[(]?\s*(?:붙임|별지|별표|서식|참고|별첨)\s*제?\s*\d/; // 붙임/별지 등 부속 머리(가나다 편람)
/** 편람 가나다-leaf 위계(`청킹: 편람가나다`): [로마자=장] > 숫자절(❖마커) > 가나다=청킹단위, + 붙임 각1청크.
 *  절은 원문 박스/볼드 마커(빌드에서 `❖N. 제목`으로 변환)로만 인식 → 평문 호(1.2.3.)·예시 번호와 확실히 구분.
 *  로마자 있으면 로마자=장(구분자)·절=중간헤더(칩)·가나다.이름="로마.숫자.가"; 없으면 절=장(구분자)·가나다.이름="숫자.가".
 *  청크 내부 ①②·-·※·□·숫자호는 들여쓰기(분리 안 함). */
function chunkGanada(content: PLine[], cap: number): { chunks: Chunk[]; via: string } {
  const cls = content.map((l) => classifyHeading(l.text.trim()));
  const toc = content.map((l) => TOC_LINE.test(l.text.trim()));
  const hasRoman = cls.some((c, i) => (c === "ROMAN" || c === "ROMANNUM") && !toc[i]);
  const romanOf = (t: string) => (t.match(new RegExp(`^[${ROMAN_CHARS}](?:-\\d+)?`)) || [""])[0]; // Ⅱ / Ⅱ-1(지표내역 등 부록) 전체 — 본편 Ⅱ와 이름 충돌 방지
  const buAt = content.findIndex((l, i) => !toc[i] && PYEONRAM_BU.test(l.text.trim()));
  const mainEnd = buAt >= 0 ? buAt : content.length;
  const out: Chunk[] = [];
  let roman = "", num = 0, curName = "", curHead = "", curPage = content[0]?.page ?? "1";
  let buf: PLine[] = [];
  const flush = () => {
    const txt = buf.map((l) => l.text).join("\n").trim();
    if (curName) out.push({ name: curName.slice(0, 70), fullText: txt || curHead, order: out.length, page: curPage, via: "HIER" }); // 한줄 절/가나다는 제목을 본문으로
    else if (buf.some((l) => l.text.trim() && !TOC_LINE.test(l.text.trim()))) for (const pc of byPage(buf)) out.push({ ...pc, order: out.length }); // 머리(표지)·장 직속 내용(목차만이면 버림)
    buf = [];
  };
  for (let i = 0; i < mainEnd; i++) {
    const t = content[i].text.trim(), c = cls[i];
    if (!toc[i]) {
      if (hasRoman && (c === "ROMAN" || c === "ROMANNUM")) {
        flush(); out.push({ name: t.slice(0, 70), fullText: "", order: out.length, page: content[i].page, via: "JANG" }); // 로마자 = 장(folder)
        roman = romanOf(t); num = 0; curName = ""; curHead = ""; buf = []; curPage = content[i].page; continue;
      }
      const sec = t.match(/^❖\s*(\d+)?[.)]?\s*(\S.*)$/); // 절 마커(빌드 변환): ❖N. 제목
      if (sec) {
        num = sec[1] ? +sec[1] : num + 1; const title = sec[2].trim();
        flush(); curHead = title; curPage = content[i].page; buf = [];
        if (hasRoman) curName = `${roman}.${num} ${title}`; // 절 = 중간 헤더 칩
        else { out.push({ name: `${num}. ${title}`.slice(0, 70), fullText: "", order: out.length, page: content[i].page, via: "JANG" }); curName = ""; } // 절 = 장(folder)
        continue;
      }
      if (c === "GANADA") {
        const m = t.match(/^([가나다라마바사아자차카타파하])[.)]\s+(\S.*)$/); // 표준 순서 글자만(예)·주) 등 예시·주석 배제)
        if (m) { flush(); curName = (hasRoman ? `${roman}.${num}.${m[1]} ${m[2].trim()}` : `${num}.${m[1]} ${m[2].trim()}`); curHead = m[2].trim(); curPage = content[i].page; buf = []; continue; }
      }
    }
    buf.push(content[i]); // ①②·-·※·□·숫자호 등은 현재 청크 본문
  }
  flush();
  if (buAt >= 0) { // 붙임/별지/별표/서식/참고 = '붙임' 그룹(folder) + 각 1청크
    const bu = content.slice(buAt);
    const bi: number[] = []; bu.forEach((l, i) => { if (PYEONRAM_BU.test(l.text.trim())) bi.push(i); });
    if (bi.length) out.push({ name: "붙임", fullText: "", order: out.length, page: bu[bi[0]].page, via: "JANG" }); // 붙임 그룹 구분자
    for (let j = 0; j < bi.length; j++) { const bs = bi[j], be = j + 1 < bi.length ? bi[j + 1] : bu.length; out.push({ name: bu[bs].text.trim().replace(/^\\?[#"'[(]+/, "").trim().slice(0, 70), fullText: bu.slice(bs, be).map((l) => l.text).join("\n").trim(), order: out.length, page: bu[bs].page, via: "ATT" }); }
  }
  return { chunks: sizeCap(out, content, cap), via: "HIER" };
}
const ATT_BYP = /^\\?[#"'[(]?\s*(?:별표|별지|서식|참고|붙임|별첨)\s*(?:표지|제?\s*\d|[가-힣]?\s*\d|[IVXⅠ-Ⅹ])/; // 별표/별지/서식/참고 부속 머리
/** 첨부 섹션 경계 {i, kind} — 로마자=하위그룹 / 별표·별지·서식·참고=부속(내부 미분할) / □·숫자절(점 유무 무관)=내용.
 *  목차줄·하위목록(리셋/장문)·부속 내부 번호·다중참조 표제목('(별표1)(별표2)…')은 경계 제외. */
function attSectionBounds(body: PLine[], toc: boolean[]): { i: number; kind: "roman" | "byp" | "sec" }[] {
  const bnds: { i: number; kind: "roman" | "byp" | "sec" }[] = [];
  let expTop = 0, inByp = false;
  const isByp = (t: string) => ATT_BYP.test(t) && !/(?:별표|별지).*(?:별표|별지)/.test(t) && t.length <= 50; // 단일참조·짧은 머리만(표제목 제외)
  for (let i = 0; i < body.length; i++) {
    if (toc[i]) continue;
    const t = body[i].text.trim(), c = classifyHeading(t);
    if (c === "ROMAN" || c === "ROMANNUM") { bnds.push({ i, kind: "roman" }); expTop = 0; inByp = false; continue; }
    if (isByp(t)) { bnds.push({ i, kind: "byp" }); inByp = true; continue; }
    if (inByp) continue; // 별표/참고 내부(번호·□)는 미분할
    if (/^[□■▣]\s*\S/.test(t)) { bnds.push({ i, kind: "sec" }); continue; }
    const m = t.match(/^(\d+)[.)]?\s+\S/); // 숫자 top절(점 있/없음 무관) — 단조+짧은 제목만
    if (m && +m[1] === expTop + 1 && t.length <= 26) { bnds.push({ i, kind: "sec" }); expTop = +m[1]; }
  }
  return bnds;
}
/** 편람 첨부자료 — 각 '첨부자료 N.' = 장(그룹) + 내부 내용기반 섹션 청킹(로마자=하위그룹, 별표/별지/서식·참고=각1청크, 크기상한). 구조 약하면 페이지 폴백. */
function chunkAttachments(plines: PLine[], cap: number): Chunk[] {
  const heads: number[] = [];
  plines.forEach((l, i) => { if (/^첨부자료\s*\d+[.\s]/.test(l.text.trim())) heads.push(i); });
  if (!heads.length) return sizeCap(byPage(plines), plines, cap);
  const acap = Math.min(cap, 4000);
  const out: Chunk[] = [];
  for (let k = 0; k < heads.length; k++) {
    const s = heads[k], e = k + 1 < heads.length ? heads[k + 1] : plines.length;
    const title = plines[s].text.trim();
    const num = (title.match(/^첨부자료\s*(\d+)/) || ["", ""])[1];
    out.push({ name: title.slice(0, 70), fullText: "", order: out.length, page: plines[s].page, via: "JANG" }); // 첨부 = 장(그룹)
    const body = plines.slice(s + 1, e);
    const toc = body.map((l) => TOC_LINE.test(l.text.trim()));
    const pushSeg = (lines: PLine[], name: string, pg: string) => {
      for (const c of sizeCap([{ name: name.replace(/^\\?[#"'[(]+/, "").trim().slice(0, 44), fullText: lines.map((l) => l.text).join("\n").trim(), order: 0, page: pg, via: "ATT" }], lines, acap))
        if (c.fullText.trim()) out.push({ ...c, name: `[첨부${num}] ${c.name}`.slice(0, 70), order: out.length, via: "ATT" });
    };
    const bnds = attSectionBounds(body, toc);
    if (bnds.length < 2) { // 구조 약함 → 페이지 폴백
      for (const pc of sizeCap(byPage(body), body, acap)) if (pc.fullText.trim()) out.push({ ...pc, name: `[첨부${num}·p.${pc.page}] ${attHeadName(pc.fullText)}`.slice(0, 70), order: out.length, via: "ATT" });
      continue;
    }
    let curRoman = ""; // 첨부자료가 유일한 그룹 레벨 — 로마자는 하위그룹(폴더) 아니라 절 칩 + 이름 접두로
    if (bnds[0].i > 0) pushSeg(body.slice(0, bnds[0].i), attHeadName(body.slice(0, bnds[0].i).map((l) => l.text).join("\n")), body[0].page);
    for (let j = 0; j < bnds.length; j++) {
      const bs = bnds[j].i, be = j + 1 < bnds.length ? bnds[j + 1].i : body.length;
      const head = body[bs].text.trim();
      if (bnds[j].kind === "roman") {
        if (bnds[j + 1]?.kind === "roman") continue; // 목차의 연속 로마자(자식 절 없음) 스킵
        curRoman = (head.match(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/) || [""])[0];
        pushSeg(body.slice(bs, be), head, body[bs].page); // 로마자 개요 = 칩
      } else if (bnds[j].kind === "sec") {
        pushSeg(body.slice(bs, be), curRoman && /^\d/.test(head) ? head.replace(/^(\d+)[.)]?\s*/, `${curRoman}.$1 `) : head, body[bs].page); // 절 이름에 로마자 접두(Ⅰ.1 …)
      } else pushSeg(body.slice(bs, be), head, body[bs].page); // 별표/별지/서식/참고
    }
  }
  return out;
}
function mergeSmall(chunks: Chunk[], min: number, protect?: (c: Chunk) => boolean): Chunk[] {
  const out: Chunk[] = [];
  for (const c of chunks) {
    if (out.length > 0 && out[out.length - 1].fullText.trim() && c.fullText.length < min && !(protect && protect(c))) {
      const prev = out[out.length - 1]; // 직전이 빈 구분자(장 헤더)면 병합하지 않음(구분자 보존)
      prev.fullText = `${prev.fullText}\n${c.name}${c.fullText ? "\n" + c.fullText : ""}`.trim();
    } else {
      out.push({ ...c });
    }
  }
  return out.map((c, i) => ({ ...c, order: i }));
}
/** 용어정의형 장(짧은 N.N 절 8개+·평균<250자)은 장 1청크로 묶고, 일반 절은 분리 유지(깊이제한 NUM 전용). */
function groupGlossary(chunks: Chunk[]): Chunk[] {
  const isChap = (n: string) => /^\d+\.\s/.test(n) && !/^\d+\.\d/.test(n);
  const out: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (isChap(c.name)) {
      const no = c.name.match(/^(\d+)\./)![1];
      const kids: Chunk[] = [];
      let j = i + 1;
      while (j < chunks.length && !isChap(chunks[j].name) && chunks[j].name.match(/^(\d+)\.\d/)?.[1] === no) { kids.push(chunks[j]); j++; }
      const avg = kids.length ? kids.reduce((s, k) => s + k.fullText.length, 0) / kids.length : 0;
      if (kids.length >= 8 && avg < 250) { // 용어정의형 장 → 장 한 청크로 병합
        out.push({ ...c, fullText: [c.fullText, ...kids.map((k) => `${k.name}\n${k.fullText}`.trim())].filter(Boolean).join("\n").trim() });
        i = j - 1; continue;
      }
    }
    out.push(c);
  }
  return out;
}
function sizeCap(chunks: Chunk[], content: PLine[], maxLen = 4000): Chunk[] {
  const MAX = maxLen;
  void content;
  if (!chunks.some((c) => c.fullText.length > MAX)) return chunks;
  const out: Chunk[] = [];
  let order = 0;
  for (const c of chunks) {
    if (c.fullText.length <= MAX) { out.push({ ...c, order: order++ }); continue; }
    const units: string[] = [];
    for (const ln of c.fullText.split("\n")) {
      if (ln.length <= MAX) units.push(ln);
      else for (let i = 0; i < ln.length; i += MAX) units.push(ln.slice(i, i + MAX));
    }
    let bufLines: string[] = [];
    let bufLen = 0;
    let part = 0;
    const flush = () => {
      const text = bufLines.join("\n").trim();
      if (text) {
        // 분할 파트명: 첫 줄이 아니면 그 안의 첫 헤딩(로마자·숫자·제N조 등)으로 — "(2)(3)" 대신 의미있는 이름
        const headLine = part === 0 ? null : bufLines.map((s) => s.trim()).find((s) => classifyHeading(s));
        const name = part === 0 ? c.name : headLine ? `${c.name} — ${headLine.slice(0, 40)}` : `${c.name} (${part + 1})`;
        out.push({ name, fullText: text, order: order++, page: c.page, via: c.via });
      }
      part++; bufLines = []; bufLen = 0;
    };
    for (const u of units) { if (bufLen + u.length > MAX && bufLines.length) flush(); bufLines.push(u); bufLen += u.length + 1; }
    flush();
  }
  return out;
}

// ───────── 문서 빌드 + 자가검수 ─────────
export type BuildOpts = {
  sourceName: string;       // 원본 파일명(제목·연번 폴백)
  category: string;         // 분류(관리자 선택/폴더)
  titleOverride?: string;
  yearOverride?: string;
  docNumberOverride?: string;
  sourceFile?: string;      // metadata.sourceFile 기록값(없으면 sourceName)
  isExtracted?: boolean;    // hwp/pdf 등 추출 텍스트면 정규화 적용
  /** 청킹 노브 기본값(교체 시 기존본 origMeta 승계용) — 원문 프런트매터가 있으면 원문이 이긴다. */
  metaDefaults?: Meta;
  stat?: MangleStat;        // 정제 통계 누적용 통(선택) — 넘기면 cleanLine이 여기에 카운트. 런타임 경로는 미사용.
};

/** 재적재 승계 대상 청킹 노브 키 — 관리자 라우트·CLI가 같은 목록을 봐야 한다(경로별 사본은 반드시 어긋난다). */
export const CHUNK_KNOB_KEYS = ["청킹", "청킹전략", "chunk", "청킹깊이", "청크깊이", "청크상한"] as const;
export function chunkKnobsOf(meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CHUNK_KNOB_KEYS) if (meta[k]) out[k] = String(meta[k]);
  return out;
}

/** 원문 텍스트(정제본 or 추출본) → 문서. 모든 청킹 노하우 적용. */
export function buildDocFromRaw(raw: string, opts: BuildOpts): Doc {
  // 추출본은 normalizeExtracted(표 변환 포함). 데이터파일(.md/.txt)에 남은 표 HTML도 항상 정규화(고아 <tr>·</table>).
  const pre = htmlTablesToPipe(opts.isExtracted ? normalizeExtracted(raw) : raw);
  const { format, meta: parsedMeta, body } = parseMeta(pre);
  // 청킹 노브 승계 — 관리자가 hwp 원본(프런트매터 없음)으로 교체해도 기존본의 세밀 청킹이 유지되게.
  const meta: Meta = { ...(opts.metaDefaults ?? {}), ...parsedMeta };
  const rawTitle = (opts.titleOverride || meta["문서명"] || meta["규정명"] || titleFromFile(opts.sourceName))
    .trim().replace(/_+/g, " ").replace(/\s*\(\d+\)\s*$/, "").replace(/\s{2,}/g, " "); // 문서명 언더바(추출 파일명 잔재) → 공백
  const { title, revision } = splitTitleRevision(rawTitle);
  const docNumber = (opts.docNumberOverride ?? docNumberFromName(opts.sourceName)) || "";
  // 시행일 우선순위: 사용자 지정 > 메타 > **부칙 최신 시행일**(문서 자체 선언, 최신 부칙) > 제목/파일명 개정표기 > 파일명 날짜 > 최신 개정마커(최후).
  const year = cleanYear(opts.yearOverride || meta["최종시행일"] || enforceDateFromBody(body) || revision || revisionFromName(opts.sourceName) || dateFromName(opts.sourceName) || markerDateFromBody(body) || "");

  let plines = tokenize(body);
  // txt는 적극 정제(글자 불변), md/추출본은 단일글자 런만. + kordoc 표 캡션·깨진 이미지 마커 제거(표 격자 자체는 보존).
  plines = plines.map((l) => {
    let t = format === "txt" ? cleanLine(l.text, opts.stat) : despaceRun(l.text);
    t = t.replace(/\s*\[표\]\s*(?:PDF|HWP)?[^|\n]*?표\s*추출/g, ""); // "[표] PDF 기준 N페이지 표 추출" 캡션(인라인 포함)
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");                     // ![image](…) 깨진 이미지
    t = t.replace(/^\s*\[표\]\s*/, "");                             // 잔여 [표] 머리표시(의미있는 표제는 텍스트 보존)
    t = t.replace(/ⓛ/g, "①");                                       // kordoc 깨진 원문자(ⓛ=U+24DB) → ①
    t = t.replace(/[➀-➉]/g, (c) => "①②③④⑤⑥⑦⑧⑨⑩"[c.charCodeAt(0) - 0x2780]); // 딩벳 원숫자 → 표준 원숫자
    t = t.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, "$1");            // mailto 마크다운 링크 → 표시 텍스트
    t = t.replace(/\\([~*_])/g, "$1");                               // 백슬래시 이스케이프(\~ 등) 해제
    return { ...l, text: t.replace(/[ \t]+$/, "") };
  });
  // 전부 빈 셀인 파이프 행 제거(표 격자 정리, 구분행 '---'·내용행은 보존). 행 자체를 빼야 표가 끊기지 않음.
  plines = plines.filter((l) => !/^\s*\|(?:\s*\|)+\s*$/.test(l.text));
  const pages = new Set(plines.map((l) => l.page)).size;
  const isReg = /^(규정|세칙|지침|법령|행정규칙)$/.test(opts.category); // 외부규범도 조문(제N조) 청킹
  const isContract = /^계약서$/.test(opts.category);
  const isManual = /^매뉴얼$/.test(opts.category);
  const { chunks: rawChunks, via } = isContract
    ? chunkContract(plines, pages)
    : isManual
      ? chunkManual(plines, pages, meta)
      : chunk(plines, pages, isReg, meta);
  // 로마자 헤더 장식(◤)·자간 정리 — 정리로 이름이 합쳐질 수 있어(예: "Ⅰ. 목 적"과 "Ⅰ ◤ 목적"이
  // 둘 다 "Ⅰ. 목적") 유일성을 여기서 한 번 더 보장한다. dedupNames만으론 정리 전 이름 기준이라 놓친다.
  const chunks = dedupNames(rawChunks.map((c) => ({ ...c, name: cleanRomanName(c.name) })));

  return {
    title, category: opts.category, docNumber, year, articles: chunks, via, pages,
    metadata: {
      docType: meta["문서종류"] || meta["규정종류"] || opts.category,
      sourceFile: (opts.sourceFile ?? opts.sourceName).normalize("NFC"),
      format, origMeta: meta, articleCount: chunks.length, chunkVia: via,
    },
  };
}

/** 비공백 글자수(보존율 산정용). */
export const nzChars = (s: string) => (s || "").replace(/\s/g, "").length;

/** 자가검수: 보존율(하한·상한·목차 제외)·빈조문·중복·부칙누수·부칙비대·항유실·중간잘림 → good/warn/bad. */
export function auditDoc(d: Doc, sourceText: string): Audit {
  const sourceChars = nzChars(sourceText);
  const chunkChars = d.articles.reduce((s, a) => s + nzChars(a.fullText), 0);
  const retentionPct = sourceChars ? Math.round((chunkChars / sourceChars) * 100) : 100;
  // 목차(점선 리더·페이지 꼬리) 줄을 분모에서 뺀 보존율 — 목차가 두꺼운 문서(환경서비스직 37% 실측)에서
  // "표지/목차 제외분"이라는 해석 여지 뒤에 실제 유실이 숨지 않게 별도 산출한다.
  const coreChars = nzChars(sourceText.split(/\r?\n/).filter((l) => !/[·.\-]{4,}\s*\S*\d+\s*$/.test(l.trim())).join("\n"));
  const retentionCorePct = coreChars ? Math.round((chunkChars / coreChars) * 100) : 100;
  const seen = new Set<string>();
  const JO = /^제\s*\d+\s*조/;
  let dup = 0, empty = 0, leak = 0, mid = 0, orphan = 0, joChunks = 0, buchikHighJo = 0;
  for (const a of d.articles) {
    if (seen.has(a.name)) dup++; seen.add(a.name);
    if (!a.fullText.trim() && a.via !== "JANG" && a.via !== "ATTACH_HDR" && a.name !== "부속서류") empty++; // 장·부속서류 구분자(빈 body)는 정상
    if (!a.name.startsWith("부칙") && /(?:^|\n)부\s*칙\s*[<([（〈]/.test(a.fullText)) leak++;
    if (a.name.startsWith("부칙")) {
      // 흡수된 본칙 감지 — 진짜 부칙의 경과규정은 제1~3조로 번호가 재시작하지만, 본칙이 조기
      // 절단돼 부칙에 흡수되면 제4조 이상 괄호제목 조문이 부칙 안에 줄줄이 남는다.
      for (const m of a.fullText.matchAll(/^제\s*(\d+)\s*조(?:의\s*\d+)?\s*[(（]/gm)) {
        if (Number(m[1]) >= 4) buchikHighJo++;
      }
    }
    const t = a.fullText.trim();
    if (JO.test(a.name)) joChunks++;
    if (JO.test(a.name) && /^[②-⑳]/.test(t)) orphan++;
    if (JO.test(a.name) && /^(?:고 |며 |면 |나 |거나 |하여 |에게 |에서 |으로 |로서 )/.test(t)) mid++;
  }
  // 부칙 비대 — 부칙 안에 높은 번호(제4조+) 괄호제목 조문이 2개 이상이면 본칙 흡수(조기 절단) 신호.
  // 단순 분량 비율은 개정 이력이 긴 규정(직제 규정 부칙 63% 실측 — 정상)에서 오경보라 쓰지 않는다.
  const buchikBloat = joChunks >= 3 && buchikHighJo >= 2;
  const flags: string[] = [];
  if (!d.title) flags.push("제목 비어있음");
  if (!d.articles.length) flags.push("조문 0개(추출 실패 가능)");
  if (empty) flags.push(`빈 조문 ${empty}개`);
  if (dup) flags.push(`중복 청크명 ${dup}개`);
  if (leak) flags.push(`부칙 누수 ${leak}개`);
  if (buchikBloat) flags.push(`부칙에 본칙 조문 흡수 의심(제4조+ 괄호제목 ${buchikHighJo}개) — 본칙 조기 절단 확인 필요`);
  if (orphan) flags.push(`항 유실(②~ 시작) ${orphan}개`);
  if (mid) flags.push(`중간잘림 의심 ${mid}개`);
  if (sourceChars > 0 && retentionPct < 70) flags.push(`본문 보존율 ${retentionPct}% (낮음 — 표지/목차 제외분 감안)`);
  if (sourceChars > 0 && retentionPct > 105) flags.push(`본문 보존율 ${retentionPct}% (100% 초과 — 같은 내용이 여러 청크에 중복 의심)`);
  if (coreChars > 0 && retentionCorePct < 70 && retentionPct >= 55) flags.push(`목차 제외 보존율 ${retentionCorePct}% — 목차를 감안해도 유실이 큼`);
  const bad = !d.articles.length || empty > 0 || leak > 0 || (sourceChars > 0 && retentionPct < 55) || !d.title;
  const warn = dup > 0 || orphan > 0 || mid > 0 || buchikBloat
    || (sourceChars > 0 && (retentionPct < 80 || retentionPct > 105))
    || (coreChars > 0 && retentionCorePct < 70);
  const score: Audit["score"] = bad ? "bad" : warn ? "warn" : "good";
  return { sourceChars, chunkChars, retentionPct, retentionCorePct, chunks: d.articles.length, empty, dup, buchikLeak: leak, midSentence: mid, orphanHang: orphan, emptyTitle: !d.title, flags, score };
}

export type IngestResult = { doc: Doc; audit: Audit };
/** 원문 텍스트 → 문서 + 자가검수(한 번에). */
export function ingestText(raw: string, opts: BuildOpts): IngestResult {
  const doc = buildDocFromRaw(raw, opts);
  // 검수 기준 원문: 추출본은 정규화 후(표지/메타 제외 전) 텍스트, 정제본은 본문
  const { body } = parseMeta(opts.isExtracted ? normalizeExtracted(raw) : raw);
  const audit = auditDoc(doc, body);
  return { doc, audit };
}
