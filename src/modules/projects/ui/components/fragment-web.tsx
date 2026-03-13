import { useEffect, useState } from "react";
import { ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";

import { Hint } from "@/components/hint";
import { Fragment } from "@/generated/prisma";
import { Button } from "@/components/ui/button";

interface Props {
  data: Fragment;
};

const HEARTBEAT_INTERVAL_MS = 60_000;

export function FragmentWeb({ data }: Props) {
  const [copied, setCopied] = useState(false);
  const [fragmentKey, setFragmentKey] = useState(0);

  useEffect(() => {
    if (!data?.id || !data?.sandboxUrl) return;
    let isActive = true;

    const sendHeartbeat = async () => {
      if (!isActive) return;
      try {
        await fetch("/api/sandbox/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fragmentId: data.id }),
        });
      } catch {
        // Best-effort heartbeat; ignore failures.
      }
    };

    void sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [data?.id, data?.sandboxUrl]);

  const onRefresh = () => {
    setFragmentKey((prev) => prev + 1);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(data.sandboxUrl);
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
            disabled={!data.sandboxUrl || copied}
            className="flex-1 justify-start text-start font-normal"
          >
            <span className="truncate">
              {data.sandboxUrl}
            </span>
          </Button>
        </Hint>
        <Hint text="Open in a new tab" side="bottom" align="start">
          <Button
            size="sm"
            disabled={!data.sandboxUrl}
            variant="outline"
            onClick={() => {
              if (!data.sandboxUrl) return;
              window.open(data.sandboxUrl, "_blank");
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
      </div>
      <iframe
        key={fragmentKey}
        className="h-full w-full"
        sandbox="allow-forms allow-scripts allow-same-origin"
        loading="lazy"
        src={data.sandboxUrl}
      />
    </div>
  )
};
