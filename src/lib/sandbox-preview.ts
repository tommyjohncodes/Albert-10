import { Sandbox } from "@e2b/code-interpreter";

export const SANDBOX_PREVIEW_PORT = 3000;

const PREVIEW_URL = `http://127.0.0.1:${SANDBOX_PREVIEW_PORT}/`;
const PREVIEW_CHECK_TIMEOUT_MS = 10_000;
const PREVIEW_BOOT_TIMEOUT_MS = 180_000;
const PREVIEW_RESTART_TIMEOUT_MS = 300_000;
const PREVIEW_FALLBACK_RESTART_TIMEOUT_MS = 15_000;

const checkPreviewCommand =
  `bash -lc 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true'`;

const restartPreviewCommand = [
  "set -e",
  "cd /home/user",
  `if command -v ss >/dev/null 2>&1; then pid=$(ss -ltnp '( sport = :${SANDBOX_PREVIEW_PORT} )' 2>/dev/null | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | head -n 1); fi`,
  'if [ -n "$pid" ]; then kill "$pid" || true; fi',
  `if command -v lsof >/dev/null 2>&1; then pids=$(lsof -ti tcp:${SANDBOX_PREVIEW_PORT} 2>/dev/null || true); if [ -n "$pids" ]; then kill $pids || true; fi; fi`,
  `if command -v fuser >/dev/null 2>&1; then fuser -k ${SANDBOX_PREVIEW_PORT}/tcp >/dev/null 2>&1 || true; fi`,
  "NEXT_BIN='./node_modules/.bin/next'",
  "if [ ! -x \"$NEXT_BIN\" ]; then NEXT_BIN='npx next'; fi",
  "nohup bash -lc \"cd /home/user && NEXT_TELEMETRY_DISABLED=1 $NEXT_BIN dev --turbopack --hostname 0.0.0.0 --port 3000\" >/var/tmp/next-preview.log 2>&1 &",
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
      timeoutMs: PREVIEW_RESTART_TIMEOUT_MS,
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

  try {
    await restartPreviewServer(sandbox, sandboxId);
  } catch (error) {
    const stdout = await readPreviewLog(sandbox);
    const messageParts = [
      `Preview boot command failed for sandbox ${sandboxId}.`,
    ];
    if (stdout) {
      messageParts.push(`Recent log output:\n${stdout}`);
    }
    const fallbackCommand = [
      "set -e",
      "cd /home/user",
      `if command -v fuser >/dev/null 2>&1; then fuser -k ${SANDBOX_PREVIEW_PORT}/tcp >/dev/null 2>&1 || true; fi`,
      "nohup bash -lc \"cd /home/user && NEXT_TELEMETRY_DISABLED=1 npx next dev --turbopack --hostname 0.0.0.0 --port 3000\" >/var/tmp/next-preview.log 2>&1 &",
    ].join("\n");
    try {
      await sandbox.commands.run(fallbackCommand, {
        timeoutMs: PREVIEW_FALLBACK_RESTART_TIMEOUT_MS,
      });
    } catch {
      throw new Error(messageParts.join("\n"), { cause: error });
    }
  }

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
