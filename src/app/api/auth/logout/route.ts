import { NextResponse } from "next/server";

/** AX Playground — 로그인 없음. 호환을 위해 no-op 성공만 반환. 물리 삭제는 P11. */
export async function POST() {
  return NextResponse.json({ ok: true });
}
