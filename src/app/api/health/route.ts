import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";

export async function GET() {
  await connectDb();
  return NextResponse.json({ ok: true });
}

