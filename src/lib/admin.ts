import "server-only";

export function isAdmin(userId: string | null): boolean {
  if (!userId) {
    return false;
  }

  const raw = process.env.ADMIN_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return ids.includes(userId);
}
