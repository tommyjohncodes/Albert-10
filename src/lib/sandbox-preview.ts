import { Sandbox } from "@e2b/code-interpreter";

export const SANDBOX_PREVIEW_PORT = 3000;

const PREVIEW_URL = `http://127.0.0.1:${SANDBOX_PREVIEW_PORT}/`;
const PREVIEW_CHECK_TIMEOUT_MS = 10_000;
const PREVIEW_BOOT_TIMEOUT_MS = 180_000;

const checkPreviewCommand =
  `bash -lc 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true'`;

const restartPreviewCommand = [
  "set -e",
  "cd /home/user",
  `if command -v ss >/dev/null 2>&1; then pid=$(ss -ltnp '( sport = :${SANDBOX_PREVIEW_PORT} )' 2>/dev/null | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | head -n 1); fi`,
  'if [ -n "$pid" ]; then kill "$pid" || true; fi',
  `if command -v lsof >/dev/null 2>&1; then pids=$(lsof -ti tcp:${SANDBOX_PREVIEW_PORT} 2>/dev/null || true); if [ -n "$pids" ]; then kill $pids || true; fi; fi`,
  "pkill -f \"next dev\" >/dev/null 2>&1 || true",
  "LOCKFILE=''",
  "if [ -f package-lock.json ]; then LOCKFILE='package-lock.json'; fi",
  "if [ -z \"$LOCKFILE\" ] && [ -f pnpm-lock.yaml ]; then LOCKFILE='pnpm-lock.yaml'; fi",
  "if [ -z \"$LOCKFILE\" ] && [ -f yarn.lock ]; then LOCKFILE='yarn.lock'; fi",
  "STAMP='node_modules/.albert-deps-stamp'",
  "if [ -f package.json ]; then",
  "  NEED_INSTALL=0",
  "  if [ ! -f \"$STAMP\" ]; then NEED_INSTALL=1; fi",
  "  if [ -n \"$LOCKFILE\" ] && [ -f \"$LOCKFILE\" ] && [ \"$LOCKFILE\" -nt \"$STAMP\" ]; then NEED_INSTALL=1; fi",
  "  if [ \"$NEED_INSTALL\" = \"1\" ]; then npm install --no-fund --no-audit; date +%s > \"$STAMP\"; fi",
  "fi",
  "nohup bash -lc 'cd /home/user && NEXT_TELEMETRY_DISABLED=1 npx next dev --turbopack --hostname 0.0.0.0 --port 3000' >/var/tmp/next-preview.log 2>&1 &",
].join("\n");

const waitForPreviewCommand = [
  "for i in $(seq 1 90); do",
  `code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true)`,
  "if [ \"$code\" = \"200\" ]; then exit 0; fi",
  "sleep 1",
  "done",
  "exit 1",
].join("; ");

async function isPreviewReady(sandbox: Sandbox) {
  try {
    const result = await sandbox.commands.run(checkPreviewCommand, {
      timeoutMs: PREVIEW_CHECK_TIMEOUT_MS,
    });

    return result.stdout.trim() === "200";
  } catch {
    return false;
  }
}

const formatCommandError = (error: unknown) => {
  if (!error || typeof error !== "object") return null;
  const err = error as { stdout?: string; stderr?: string; message?: string };
  const parts: string[] = [];
  if (typeof err.message === "string") {
    parts.push(err.message.trim());
  }
  if (typeof err.stdout === "string" && err.stdout.trim()) {
    parts.push(`stdout:\n${err.stdout.trim()}`);
  }
  if (typeof err.stderr === "string" && err.stderr.trim()) {
    parts.push(`stderr:\n${err.stderr.trim()}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
};

async function restartPreviewServer(sandbox: Sandbox, sandboxId: string) {
  try {
    await sandbox.commands.run(restartPreviewCommand, {
      timeoutMs: PREVIEW_CHECK_TIMEOUT_MS,
    });
  } catch (error) {
    const previewLog = await readPreviewLog(sandbox);
    const commandError = formatCommandError(error);
    const messageParts = [
      `Preview boot command failed for sandbox ${sandboxId}.`,
    ];
    if (commandError) {
      messageParts.push(commandError);
    }
    if (previewLog) {
      messageParts.push(`Recent log output:\n${previewLog}`);
    }
    throw new Error(messageParts.join("\n"), { cause: error });
  }
}

async function readPreviewLog(sandbox: Sandbox) {
  try {
    const result = await sandbox.commands.run(
      "sudo tail -n 80 /var/tmp/next-preview.log 2>/dev/null || true",
      { timeoutMs: PREVIEW_CHECK_TIMEOUT_MS },
    );

    return result.stdout.trim();
  } catch {
    return "";
  }
}

export async function ensureSandboxPreviewReady(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);

  if (await isPreviewReady(sandbox)) {
    return PREVIEW_URL;
  }

  await restartPreviewServer(sandbox, sandboxId);

  try {
    await sandbox.commands.run(waitForPreviewCommand, {
      timeoutMs: PREVIEW_BOOT_TIMEOUT_MS,
    });
  } catch (error) {
    const previewLog = await readPreviewLog(sandbox);
    const message = previewLog
      ? `Preview failed to start for sandbox ${sandboxId}. Recent log output:\n${previewLog}`
      : `Preview failed to start for sandbox ${sandboxId}.`;

    throw new Error(message, {
      cause: error,
    });
  }

  return PREVIEW_URL;
}
