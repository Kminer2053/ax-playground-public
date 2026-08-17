import { NextResponse } from "next/server";

/** AX Playground — 로그인 없음. 구 클라이언트 호환용: 항상 비로그인 상태 반환. 물리 삭제는 P11. */
export async function GET() {
  return NextResponse.json({ user: null });
}
