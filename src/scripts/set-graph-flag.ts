/** 그래프 확장 on/off 토글(PlaygroundConfig.ragGraphEnabled). 측정용.
 *   MONGODB_URI=... npx tsx src/scripts/set-graph-flag.ts on|off */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { PlaygroundConfigModel } from "@/models/PlaygroundConfig";

async function main() {
  const on = process.argv[2] === "on";
  await connectDb();
  await PlaygroundConfigModel.updateOne({ key: "default" }, { $set: { ragGraphEnabled: on } }, { upsert: true });
  const d = (await PlaygroundConfigModel.findOne({ key: "default" }).lean()) as { ragGraphEnabled?: boolean } | null;
  console.log("ragGraphEnabled =", d?.ragGraphEnabled, "(서버 TTL 30초 후 반영)");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
