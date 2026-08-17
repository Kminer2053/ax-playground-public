import mongoose from "mongoose";
import { env } from "@/lib/env";

declare global {
  var _mongooseConn: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const globalConn = globalThis._mongooseConn ?? { conn: null, promise: null };
globalThis._mongooseConn = globalConn;

export async function connectDb() {
  if (globalConn.conn) return globalConn.conn;

  if (!globalConn.promise) {
    globalConn.promise = mongoose
      .connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB,
        // 단일 인스턴스(수직 확장) 전제 — 감사·usage·rate-limit·조회가 한 풀을 공유하므로 넉넉히.
        maxPoolSize: 50,
        serverSelectionTimeoutMS: 10000,
        // 폐쇄망 단일 서버: 스키마 인덱스(unique·TTL·조회)를 첫 사용 시 생성·보강한다.
        // (운영에서 인덱스가 누락되면 rate-limit unique·usage 카운트·조회 성능이 무너짐 — C1)
        autoIndex: true,
      })
      .then((m) => m);
  }

  try {
    globalConn.conn = await globalConn.promise;
    return globalConn.conn;
  } catch (e) {
    globalConn.conn = null;
    globalConn.promise = null;
    throw e;
  }
}


