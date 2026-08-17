import { NextResponse } from "next/server";

/** AX Playground — 로그인 기능 제거됨. (관리자 인증은 /api/admin/auth) 물리 삭제는 P11. */
export async function POST() {
  return NextResponse.json(
    { error: "로그인 기능이 제거되었습니다. AX Playground는 로그인 없이 사용합니다." },
    { status: 410 },
  );
}
