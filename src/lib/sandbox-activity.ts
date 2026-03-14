import { SANDBOX_TIMEOUT } from "@/inngest/types";

export const ACTIVE_SANDBOX_WINDOW_MS = SANDBOX_TIMEOUT + 60_000;

export const getActiveSandboxCutoff = () =>
  new Date(Date.now() - ACTIVE_SANDBOX_WINDOW_MS);

export const isSandboxActive = (lastActiveAt: Date) =>
  Date.now() - lastActiveAt.getTime() <= ACTIVE_SANDBOX_WINDOW_MS;
