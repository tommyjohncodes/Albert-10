import { Sandbox } from "@e2b/code-interpreter";

export const SANDBOX_PREVIEW_PORT = 3000;

const PREVIEW_URL = `http://127.0.0.1:${SANDBOX_PREVIEW_PORT}/`;
const PREVIEW_CHECK_TIMEOUT_MS = 10_000;
const PREVIEW_RESTART_TIMEOUT_MS = 120_000;
const PREVIEW_BOOT_TIMEOUT_MS = 180_000;

const checkPreviewCommand =
  `bash -lc 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true'`;

// Written to a temp file in the sandbox to avoid shell-quoting/joining issues.
const RESTART_SCRIPT = `#!/bin/bash
cd /home/user

# If Next.js is already running, skip the restart — it may be compiling new files.
# Only start it if it crashed or has never been started.
if pgrep -f "next dev" > /dev/null 2>&1; then
  echo "Next.js is already running, skipping restart" >&2
  exit 0
fi

# Install dependencies if node_modules stamp is missing
STAMP="node_modules/.albert-deps-stamp"
if [ -f package.json ] && [ ! -f "$STAMP" ]; then
  npm install --no-fund --no-audit >> /var/tmp/next-preview.log 2>&1 || true
  touch "$STAMP"
fi

# Ensure shadcn runtime dependencies are present
for pkg in tw-animate-css tailwind-merge clsx; do
  if [ ! -d "node_modules/$pkg" ]; then
    npm install "$pkg" --no-fund --no-audit >> /var/tmp/next-preview.log 2>&1 || true
  fi
done

# Ensure lib/utils.ts exists (required by all shadcn components)
# Handles projects with or without a src/ directory
if [ -d src ]; then
  UTILS_PATH="src/lib/utils.ts"
else
  UTILS_PATH="lib/utils.ts"
fi
if [ ! -f "$UTILS_PATH" ]; then
  mkdir -p "$(dirname "$UTILS_PATH")"
  cat > "$UTILS_PATH" << 'UTILS_EOF'
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
UTILS_EOF
fi

# Start Next.js in a detached subshell so E2B does not track the child process
(
  nohup bash -lc 'cd /home/user && NEXT_TELEMETRY_DISABLED=1 npx next dev --turbopack --hostname 0.0.0.0 --port ${SANDBOX_PREVIEW_PORT}' >/var/tmp/next-preview.log 2>&1 &
  disown
)

exit 0
`;

const waitForPreviewCommand =
  `i=0; while [ $i -lt 90 ]; do ` +
  `code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${PREVIEW_URL} || true); ` +
  `if [ "$code" = "200" ]; then exit 0; fi; ` +
  `sleep 1; i=$((i+1)); ` +
  `done; exit 1`;

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
  await sandbox.files.write("/tmp/albert-restart.sh", RESTART_SCRIPT);
  await sandbox.commands.run("bash /tmp/albert-restart.sh", {
    timeoutMs: PREVIEW_RESTART_TIMEOUT_MS,
  });
}

async function readPreviewLog(sandbox: Sandbox) {
  try {
    const result = await sandbox.commands.run(
      "tail -n 80 /var/tmp/next-preview.log 2>/dev/null || true",
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
