"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ProgressGroupProps {
  items: Array<{ id: string; content: string }>;
  isComplete: boolean;
  variant?: "standalone" | "embedded";
}

export const ProgressGroup = ({
  items,
  isComplete,
  variant = "standalone",
}: ProgressGroupProps) => {
  const [open, setOpen] = useState(!isComplete);
  const isStandalone = variant === "standalone";

  useEffect(() => {
    if (isComplete) {
      setOpen(false);
    } else {
      setOpen(true);
    }
  }, [isComplete, items.length]);

  return (
    <div className={cn(
      "flex flex-col",
      isStandalone ? "group px-2 pb-4" : "pt-1",
    )}>
      {isStandalone && (
        <div className="flex items-center gap-2 pl-2 mb-2">
          <Image
            src="/albert-logo.png"
            alt="Albert"
            width={18}
            height={18}
            className="shrink-0"
          />
          <span className="text-sm font-medium">Albert</span>
          <span className="text-xs text-muted-foreground">
            Activity log
          </span>
        </div>
      )}
      <div className={cn(isStandalone && "pl-8.5")}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRightIcon
              className={cn(
                "size-3 transition-transform",
                open && "rotate-90"
              )}
            />
            <span>{isStandalone ? "Reasoning" : "Activity log"}</span>
            <span className="text-muted-foreground/70">
              ({items.length})
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <ul className="space-y-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <span className="mt-1 size-1.5 rounded-full bg-muted-foreground/60" />
                  <span>{item.content}</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
};
