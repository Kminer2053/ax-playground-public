/**
 * M3-0 보드 렌더캐시 — work100_boards.board(JSON) → 정적 SVG + 모션 SVG를 벤더 korea100studio로 렌더해 저장.
 * 조회 시 렌더 비용 0(보드 모달이 캐시 SVG를 그대로 인라인). 모션은 설계 §4 규약 적용:
 *   ① 모든 id에 `_m` 접미(정적 SVG와 같은 문서 공존 시 filter/marker id 충돌로 카드 소실 방지)
 *   ② repeatCount="indefinite" → "1" + <animate>에 fill="freeze" (1회 재생 후 종료상태 고정, 재생은 setCurrentTime(0))
 *
 * 실행: MONGODB_URI=... node src/scripts/cache-work100-boards.mjs [--task task:...] [--force] [--profile <보드 프로파일>]
 *   --profile 기본값 gov(공공 일반). 기관 전용 프로파일이 있으면 인자로 지정한다.
 */
import { MongoClient } from "mongodb";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOARD_CLI = path.join(ROOT, "vendor/korea100studio/scripts/board.mjs");
const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB = process.env.MONGODB_DB || "axplayground";
const ONLY = process.argv.includes("--task") ? process.argv[process.argv.indexOf("--task") + 1] : null;
const FORCE = process.argv.includes("--force");
/** 보드 렌더 프로파일 — 기본 gov(공공 일반). --profile 또는 BOARD_PROFILE 로 재정의. */
const PROFILE = process.argv.includes("--profile")
  ? process.argv[process.argv.indexOf("--profile") + 1]
  : process.env.BOARD_PROFILE || "gov";

/** 벤더 CLI로 board JSON을 SVG(정적/모션) 렌더. board.mjs는 파일 입력을 받으므로 임시파일 경유. */
function render(boardJson, mode) {
  const tmp = path.join(os.tmpdir(), `bc-${process.pid}-${Math.round(performance.now())}.json`);
  fs.writeFileSync(tmp, JSON.stringify(boardJson));
  try {
    const out = execFileSync("node", [BOARD_CLI, mode, tmp, "--out", "/dev/stdout", "--profile", PROFILE], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    }).toString();
    // board.mjs는 SVG를 쓴 뒤 출력 경로("/dev/stdout")를 로그로 한 줄 더 찍는다.
    // 그대로 저장하면 XML 뒤에 잡문자가 붙어 <img src="data:image/svg+xml;base64,…">가 디코딩에 실패한다
    // (innerHTML로 인라인할 때는 관대해서 오래 눈에 띄지 않았다). 닫는 태그까지만 남긴다.
    const end = out.lastIndexOf("</svg>");
    return end >= 0 ? out.slice(0, end + 6) : out;
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** 모션 SVG 규약화: 전 id `_m` 접미(참조 동반) + repeatCount 1 + fill=freeze. */
function normalizeMotion(svg) {
  const ids = [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
  for (const id of ids) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    svg = svg
      .replace(new RegExp(`\\bid="${e}"`, "g"), `id="${id}_m"`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}_m)`)
      .replace(new RegExp(`(\\bhref|xlink:href)="#${e}"`, "g"), `$1="#${id}_m"`)
      .replace(new RegExp(`\\bbegin="${e}\\.`, "g"), `begin="${id}_m.`);
  }
  svg = svg.replace(/repeatCount="indefinite"/g, 'repeatCount="1"');
  // fill 미지정 <animate…>에 freeze 추가(종료상태 고정)
  svg = svg.replace(/<animate\b([^>]*?)\s*\/>/g, (full, attrs) =>
    /\bfill=/.test(attrs) ? full : `<animate${attrs} fill="freeze"/>`,
  );
  return svg;
}

async function main() {
  const client = await MongoClient.connect(URI);
  const coll = client.db(DB).collection("work100_boards");
  const q = ONLY ? { taskId: ONLY } : {};
  const docs = await coll.find(q).project({ taskId: 1, board: 1, svg: 1 }).toArray();
  if (!docs.length) throw new Error("대상 보드 없음");

  let done = 0;
  let skip = 0;
  let fail = 0;
  for (const d of docs) {
    if (d.svg && !FORCE) {
      skip++;
      continue;
    }
    try {
      const svg = render(d.board, "render");
      const motionSvg = normalizeMotion(render(d.board, "motion"));
      // 규약 검증: 정적·모션 id 교집합 0(충돌 방지 확인)
      const sid = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const mid = [...motionSvg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      const clash = mid.filter((x) => sid.has(x));
      if (clash.length) throw new Error(`id 충돌 잔존: ${clash.join(",")}`);
      await coll.updateOne(
        { taskId: d.taskId },
        { $set: { svg, motionSvg, renderCachedAt: new Date() } },
      );
      done++;
      if (done % 20 === 0) console.log(`  … ${done} 렌더`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${d.taskId}: ${String(e.message).slice(0, 90)}`);
    }
  }
  console.log(`[렌더캐시] 완료 ${done} · 스킵 ${skip}(기존, --force로 재생성) · 실패 ${fail} / 총 ${docs.length}`);
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
