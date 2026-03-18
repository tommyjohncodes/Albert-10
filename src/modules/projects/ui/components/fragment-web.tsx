import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FragmentPreview } from "../../types";
import { useElementPicker } from "./element-picker-context";

interface Props {
  data: FragmentPreview;
};

export function FragmentWeb({ data }: Props) {
  const [fragmentKey, setFragmentKey] = useState(0);
  const [currentSandboxUrl, setCurrentSandboxUrl] = useState<string | null>(
    data?.sandboxUrl ?? null,
  );
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

  const wakeSandbox = useCallback(async (force = false) => {
    if (!data?.id || !data?.sandboxUrl) return false;
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
      } catch {
        nextSandboxUrl = null;
      }
      if (nextSandboxUrl && nextSandboxUrl !== currentSandboxUrl) {
        setCurrentSandboxUrl(nextSandboxUrl);
        setFragmentKey((prev) => prev + 1);
      } else if (shouldReload) {
        setFragmentKey((prev) => prev + 1);
      }
      return res.ok;
    } catch {
      return false;
    }
  }, [data?.id, data?.sandboxUrl, currentSandboxUrl]);

  // Single wake when preview is first shown; no periodic heartbeat to minimize E2B usage.
  useEffect(() => {
    if (!data?.id || !data?.sandboxUrl) return;
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
