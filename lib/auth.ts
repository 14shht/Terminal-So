import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export type AppRole = "student" | "admin";

export type SessionUser = {
  username: string;
  name: string;
  role: AppRole;
};

type AppUserRecord = SessionUser & {
  password: string;
};

const COOKIE_NAME = "uwls_session";

const getSecretKey = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
};

export const getAppUsers = (): AppUserRecord[] => {
  const raw = process.env.APP_USERS;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as AppUserRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const createSessionToken = async (user: SessionUser): Promise<string> => {
  const key = getSecretKey();
  return await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
};

export const verifySessionToken = async (token: string): Promise<SessionUser | null> => {
  try {
    const key = getSecretKey();
    const verified = await jwtVerify(token, key);
    const payload = verified.payload as SessionUser;
    if (!payload?.username || !payload?.name || !payload?.role) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const setSessionCookie = async (user: SessionUser) => {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
};

export const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
};

export const getSessionUser = async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return await verifySessionToken(token);
};

