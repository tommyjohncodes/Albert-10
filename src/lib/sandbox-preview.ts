import { Sandbox } from "@e2b/code-interpreter";

export const SANDBOX_PREVIEW_PORT = 3000;

const PREVIEW_URL = `http://127.0.0.1:${SANDBOX_PREVIEW_PORT}/`;
const PREVIEW_CHECK_TIMEOUT_MS = 10_000;
const PREVIEW_BOOT_TIMEOUT_MS = 90_000;

const checkPreviewCommand =
  `bash -lc 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true'`;

const restartPreviewCommand = [
  `pid=$(sudo ss -ltnp '( sport = :${SANDBOX_PREVIEW_PORT} )' | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | head -n 1)`,
  'if [ -n "$pid" ]; then sudo kill "$pid" || true; fi',
  "sudo bash -lc 'nohup bash /compile_page.sh >/var/tmp/next-preview.log 2>&1 &'",
].join("; ");

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

async function restartPreviewServer(sandbox: Sandbox) {
  await sandbox.commands.run(restartPreviewCommand, {
    timeoutMs: PREVIEW_CHECK_TIMEOUT_MS,
  });
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

  await restartPreviewServer(sandbox);

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
