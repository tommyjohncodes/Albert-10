import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";

import { Hint } from "@/components/hint";
import { FragmentPreview } from "../types";
import { Button } from "@/components/ui/button";
import { useElementPicker } from "./element-picker-context";

interface Props {
  data: FragmentPreview;
};

const HEARTBEAT_INTERVAL_MS = 60_000;

export function FragmentWeb({ data }: Props) {
  const [copied, setCopied] = useState(false);
  const [fragmentKey, setFragmentKey] = useState(0);
  const [currentSandboxUrl, setCurrentSandboxUrl] = useState<string | null>(
    data?.sandboxUrl ?? null,
  );
  const lastWakeAtRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { isPicking, setPreviewTarget, stopPicking } = useElementPicker();

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

  useEffect(() => {
    if (!data?.id || !data?.sandboxUrl) {
      return;
    }
    let isActive = true;

    const sendHeartbeat = async () => {
      if (!isActive) return;
      await wakeSandbox();
    };

    void wakeSandbox(true).then(() => {});
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [data?.id, data?.sandboxUrl, wakeSandbox]);

  const onRefresh = async () => {
    await wakeSandbox(true);
    setFragmentKey((prev) => prev + 1);
  };

  const handleCopy = () => {
    if (currentSandboxUrl) {
      navigator.clipboard.writeText(currentSandboxUrl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col w-full h-full">
      <div className="p-2 border-b bg-sidebar flex items-center gap-x-2">
        <Hint text="Refresh" side="bottom" align="start">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCcwIcon />
          </Button>
        </Hint>
        {isPicking && (
          <div className="rounded-full border px-2 py-1 text-xs font-medium bg-muted/60">
            Picking element… press Esc to cancel
          </div>
        )}
        <Hint text="Click to copy" side="bottom">
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleCopy}
            disabled={!currentSandboxUrl || copied}
            className="flex-1 justify-start text-start font-normal"
          >
            <span className="truncate">
              {currentSandboxUrl ?? ""}
            </span>
          </Button>
        </Hint>
        <Hint text="Open in a new tab" side="bottom" align="start">
          <Button
            size="sm"
            disabled={!currentSandboxUrl}
            variant="outline"
            onClick={() => {
              if (!currentSandboxUrl) return;
              window.open(currentSandboxUrl, "_blank");
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
        {isPicking && (
          <Button size="sm" variant="ghost" onClick={stopPicking}>
            Cancel
          </Button>
        )}
      </div>
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
