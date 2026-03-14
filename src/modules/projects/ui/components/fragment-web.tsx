import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";

import { Hint } from "@/components/hint";
import { FragmentPreview } from "../types";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    setCurrentSandboxUrl(data?.sandboxUrl ?? null);
  }, [data?.sandboxUrl]);

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
      try {
        const payload = await res.json();
        nextSandboxUrl =
          typeof payload?.sandboxUrl === "string" ? payload.sandboxUrl : null;
      } catch {
        nextSandboxUrl = null;
      }
      if (nextSandboxUrl && nextSandboxUrl !== currentSandboxUrl) {
        setCurrentSandboxUrl(nextSandboxUrl);
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
      </div>
      <div className="relative flex-1">
        <iframe
          key={fragmentKey}
          className="h-full w-full"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={currentSandboxUrl ?? undefined}
          onPointerDown={() => wakeSandbox()}
          onFocus={() => wakeSandbox()}
        />
      </div>
    </div>
  )
};
