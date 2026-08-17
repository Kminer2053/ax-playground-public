// @rhwp/core 의 WASM(rhwp_bg.wasm)을 /public 으로 복사한다.
// 폐쇄망: 런타임에 외부 CDN을 받지 않고 같은 출처(/rhwp_bg.wasm)에서 로드하기 위함.
// dev/build 전에 자동 실행(predev/prebuild). 산출물은 .gitignore (5.5MB 바이너리 비커밋).
import { copyFileSync, existsSync } from "node:fs";

const SRC = "node_modules/@rhwp/core/rhwp_bg.wasm";
const DST = "public/rhwp_bg.wasm";

if (existsSync(SRC)) {
  copyFileSync(SRC, DST);
  console.log("[copy-wasm] rhwp_bg.wasm → public/ (HWPX 미리보기용)");
} else {
  console.warn("[copy-wasm] @rhwp/core WASM 미발견 — `npm install` 후 다시 시도");
}
