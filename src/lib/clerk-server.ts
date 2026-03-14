import fs from "fs";
import path from "path";
import { createClerkClient } from "@clerk/nextjs/server";

let cachedSecretKey: string | null | undefined = undefined;
let cachedClient: ReturnType<typeof createClerkClient> | null = null;

const readEnvFile = (filePath: string) => {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
};

const parseEnvValue = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const loadSecretKeyFromEnvFiles = () => {
  const root = process.cwd();
  const candidates = [".env.local", ".env"];

  for (const candidate of candidates) {
    const filePath = path.join(root, candidate);
    const contents = readEnvFile(filePath);
    if (!contents) continue;

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (key !== "CLERK_SECRET_KEY") continue;
      const rawValue = trimmed.slice(idx + 1);
      return parseEnvValue(rawValue);
    }
  }

  return null;
};

export const getClerkSecretKey = () => {
  if (cachedSecretKey !== undefined) {
    return cachedSecretKey;
  }

  if (process.env.CLERK_SECRET_KEY) {
    cachedSecretKey = process.env.CLERK_SECRET_KEY;
    return cachedSecretKey;
  }

  const fileSecret = loadSecretKeyFromEnvFiles();
  if (fileSecret) {
    process.env.CLERK_SECRET_KEY = fileSecret;
    cachedSecretKey = fileSecret;
    return cachedSecretKey;
  }

  cachedSecretKey = null;
  return cachedSecretKey;
};

export const getClerkClient = () => {
  const secretKey = getClerkSecretKey();
  if (!secretKey) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClerkClient({ secretKey });
  }

  return cachedClient;
};
