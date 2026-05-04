import { NextResponse } from "next/server";
import { getAppUsers, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = body?.username?.toString?.().trim?.() ?? "";
  const password = body?.password?.toString?.() ?? "";

  if (!username || !password) {
    return NextResponse.json({ message: "Username dan password wajib diisi." }, { status: 400 });
  }

  const user = getAppUsers().find(
    (item) => item.username === username && item.password === password,
  );

  if (!user) {
    return NextResponse.json({ message: "Username atau password salah." }, { status: 401 });
  }

  const sessionUser = {
    username: user.username,
    role: user.role,
  } as const;

  await setSessionCookie(sessionUser);
  return NextResponse.json({ user: sessionUser });
}

