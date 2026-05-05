import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export const hashPassword = (plain: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEY_LEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
};

export const verifyPassword = (plain: string, stored: string): boolean => {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const expectedHex = parts[2];
  const actualHex = scryptSync(plain, salt, KEY_LEN).toString("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};
