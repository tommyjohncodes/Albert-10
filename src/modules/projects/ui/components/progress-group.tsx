"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BrainIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  RefreshCcwIcon,
  TerminalIcon,
} from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const isStandalone = variant === "standalone";
  const isWorking = !isComplete;

  useEffect(() => {
    if (isComplete) {
      setOpen(false);
    }
  }, [isComplete]);

  const itemIcons = useMemo(() => {
    return items.map((item) => {
      const value = item.content.toLowerCase();
      if (value.includes("planning")) return BrainIcon;
      if (value.includes("ran command") || value.includes("command")) return TerminalIcon;
      if (value.includes("opened") || value.includes("read")) return BookOpenIcon;
      if (value.includes("created")) return FilePlusIcon;
      if (value.includes("edited") || value.includes("updated")) return FilePenIcon;
      if (value.includes("restart") || value.includes("restarting")) return RefreshCcwIcon;
      return FileTextIcon;
    });
  }, [items]);

  const actionPreview = itemIcons.slice(0, 6);
  const remainingActions = Math.max(items.length - actionPreview.length, 0);

  return (
    <div className={cn(
      "flex flex-col",
      isStandalone ? "group px-3 pb-3" : "pt-1",
    )}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <span className="flex size-7 items-center justify-center rounded-lg border bg-muted/60">
            {open ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
          </span>
          <span className="font-medium">
            {open ? "Show less" : "Show more"}
          </span>
          <span className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {actionPreview.map((Icon, index) => (
                <span
                  key={`action-${index}`}
                  className="flex size-6 items-center justify-center rounded-lg border bg-background"
                >
                  <Icon className="size-3.5" />
                </span>
              ))}
              {remainingActions > 0 && (
                <span className="px-1 text-[10px] font-medium">
                  +{remainingActions}
                </span>
              )}
            </span>
            <span>{items.length} actions</span>
          </span>
          {isWorking && (
            <span className="ml-auto flex items-center">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border bg-muted/50 text-primary",
                  "animate-pulse shadow-[0_0_14px_rgba(99,102,241,0.5)]"
                )}
              >
                <BrainIcon className="size-3.5" />
              </span>
              <span className="ml-2 text-xs font-medium text-muted-foreground">
                Working
                <span className="inline-flex items-center">
                  <span className="animate-pulse" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="animate-pulse" style={{ animationDelay: "150ms" }}>.</span>
                  <span className="animate-pulse" style={{ animationDelay: "300ms" }}>.</span>
                </span>
              </span>
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ul className="space-y-1">
            {items.map((item, index) => {
              const Icon = itemIcons[index] ?? FileTextIcon;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-2 py-1 text-sm text-muted-foreground"
                >
                  <span className="mt-0.5 flex size-7 items-center justify-center rounded-lg border bg-background">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="leading-relaxed">{item.content}</span>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
