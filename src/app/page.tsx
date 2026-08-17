import { PlaygroundHome } from "@/components/playground/PlaygroundHome";
import { recordUsage } from "@/lib/usage";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { resolveBuildings } from "@/lib/playground-map";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  recordUsage("site", "visit"); // 사이트 접속(홈 진입) 계측
  // 건물 오버라이드(이름·외부연계·숨김)는 서버에서 병합해 내려준다 — 클라 fetch 시 라벨 깜빡임 방지.
  const cfg = await getPlaygroundConfig();
  return <PlaygroundHome buildings={resolveBuildings(cfg.panelOverrides)} />;
}
