import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FragmentPreview } from "../../types";
import { useElementPicker } from "./element-picker-context";

interface Props {
  data: FragmentPreview;
  projectId: string;
};

export function FragmentWeb({ data, projectId }: Props) {
  const [fragmentKey, setFragmentKey] = useState(0);
  const [currentSandboxUrl, setCurrentSandboxUrl] = useState<string | null>(
    data?.sandboxUrl ?? null,
  );
  const [isStarting, setIsStarting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const lastWakeAtRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { isPicking, setPreviewTarget } = useElementPicker();

  const previewOrigin = useMemo(() => {
    if (!currentSandboxUrl) return null;
    try {
      return new URL(currentSandboxUrl).origin;
    } catch {
      return null;
    }
  }, [currentSandboxUrl]);

  useEffect(() => {
    setCurrentSandboxUrl(data?.sandboxUrl ?? null);
  }, [data?.sandboxUrl]);

  useEffect(() => {
    setPreviewTarget({
      window: iframeRef.current?.contentWindow ?? null,
      origin: previewOrigin,
      url: currentSandboxUrl,
    });
  }, [currentSandboxUrl, previewOrigin, setPreviewTarget]);

  const startSandbox = useCallback(async () => {
    if (!projectId) return null;
    setIsStarting(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Sandbox start failed.";
        setPreviewError(message);
        return null;
      }
      const nextSandboxUrl =
        typeof payload?.sandboxUrl === "string" ? payload.sandboxUrl : null;
      if (nextSandboxUrl) {
        setCurrentSandboxUrl(nextSandboxUrl);
        setFragmentKey((prev) => prev + 1);
      }
      return nextSandboxUrl;
    } catch {
      setPreviewError("Sandbox start failed.");
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [projectId]);

  const wakeSandbox = useCallback(async (force = false) => {
    if (!data?.id) return false;
    if (!data?.sandboxUrl) {
      const started = await startSandbox();
      return Boolean(started);
    }
    const now = Date.now();
    if (!force && now - lastWakeAtRef.current < 5000) return true;
    lastWakeAtRef.current = now;
    try {
      const res = await fetch("/api/sandbox/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fragmentId: data.id }),
      });
      let nextSandboxUrl: string | null = null;
      let shouldReload = false;
      try {
        const payload = await res.json();
        nextSandboxUrl =
          typeof payload?.sandboxUrl === "string" ? payload.sandboxUrl : null;
        shouldReload = Boolean(payload?.pickerReload);
        if (!res.ok && typeof payload?.error === "string") {
          setPreviewError(payload.error);
        }
      } catch {
        nextSandboxUrl = null;
      }
      if (nextSandboxUrl && nextSandboxUrl !== currentSandboxUrl) {
        setCurrentSandboxUrl(nextSandboxUrl);
        setFragmentKey((prev) => prev + 1);
        setPreviewError(null);
      } else if (shouldReload) {
        setFragmentKey((prev) => prev + 1);
      }
      return res.ok;
    } catch {
      setPreviewError("Sandbox heartbeat failed.");
      return false;
    }
  }, [data?.id, data?.sandboxUrl, currentSandboxUrl, startSandbox]);

  // Single wake when preview is first shown; no periodic heartbeat to minimize E2B usage.
  useEffect(() => {
    if (!data?.id) return;
    void wakeSandbox(true);
  }, [data?.id, data?.sandboxUrl, wakeSandbox]);

  const onRefresh = useCallback(async () => {
    await wakeSandbox(true);
    setFragmentKey((prev) => prev + 1);
  }, [wakeSandbox]);

  const onOpenInNewTab = useCallback(() => {
    if (!currentSandboxUrl) return;
    window.open(currentSandboxUrl, "_blank", "noreferrer");
  }, [currentSandboxUrl]);

  useEffect(() => {
    const handleRefresh = () => {
      void onRefresh();
    };
    const handleOpen = () => {
      onOpenInNewTab();
    };
    window.addEventListener("albert:preview-refresh", handleRefresh);
    window.addEventListener("albert:preview-open", handleOpen);
    return () => {
      window.removeEventListener("albert:preview-refresh", handleRefresh);
      window.removeEventListener("albert:preview-open", handleOpen);
    };
  }, [onRefresh, onOpenInNewTab]);

  return (
    <div className="flex flex-col w-full h-full">
      <div className="relative flex-1">
        {(!currentSandboxUrl || isStarting || previewError) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
            <div className="max-w-md rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
              {isStarting && !previewError && (
                <p>Starting preview…</p>
              )}
              {!isStarting && previewError && (
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Preview failed to start</p>
                  <p className="whitespace-pre-wrap">{previewError}</p>
                  <button
                    className="mt-2 inline-flex items-center rounded-md border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => void wakeSandbox(true)}
                  >
                    Retry
                  </button>
                </div>
              )}
              {!isStarting && !previewError && !currentSandboxUrl && (
                <div className="space-y-2">
                  <p>Preview is initializing…</p>
                  <button
                    className="inline-flex items-center rounded-md border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => void wakeSandbox(true)}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {isPicking && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-6">
            <div className="rounded-full border bg-background/95 px-3 py-1 text-xs font-medium shadow-sm">
              Click an element in the preview to target it.
            </div>
          </div>
        )}
        <iframe
          key={fragmentKey}
          ref={iframeRef}
          className="h-full w-full"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={currentSandboxUrl ?? undefined}
          onPointerDown={() => wakeSandbox()}
          onFocus={() => wakeSandbox()}
          onError={() => {
            setPreviewError("Preview failed to load.");
          }}
          onLoad={() => {
            setPreviewTarget({
              window: iframeRef.current?.contentWindow ?? null,
              origin: previewOrigin,
              url: currentSandboxUrl,
            });
          }}
        />
      </div>
    </div>
  )
};
