import "./load-env";

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { LibraryPostModel } from "../models/LibraryPost";

/**
 * AX 라이브러리(프롬프트 도서관) 샘플 게시물 시드.
 * data/samples/library-posts.json 을 적재하며, 같은 title 이 이미 있으면 건너뛴다(멱등).
 * 실행: npm run seed:library-sample
 */

type SamplePost = {
  board: "prompt" | "video" | "file";
  title: string;
  content: string;
  usage?: string;
  author: string;
  pinned?: boolean;
};

async function main() {
  const file = path.join(process.cwd(), "data", "samples", "library-posts.json");
  const posts = JSON.parse(fs.readFileSync(file, "utf-8")) as SamplePost[];

  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  let added = 0;
  let skipped = 0;
  for (const p of posts) {
    const exists = await LibraryPostModel.exists({ board: p.board, title: p.title });
    if (exists) {
      skipped += 1;
      continue;
    }
    await LibraryPostModel.create({
      board: p.board,
      title: p.title,
      content: p.content,
      usage: p.usage ?? "",
      author: p.author,
      pinned: p.pinned ?? false,
    });
    added += 1;
  }

  console.log(`Library sample seed completed: ${added}건 추가, ${skipped}건 건너뜀(동일 제목 존재).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
