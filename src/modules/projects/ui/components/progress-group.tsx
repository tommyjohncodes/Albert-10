"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BrainIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  RefreshCcwIcon,
  ScrollTextIcon,
  SparklesIcon,
  WrenchIcon,
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
      if (value.includes("opened")) return BookOpenIcon;
      if (value.includes("created")) return FilePlusIcon;
      if (value.includes("edited") || value.includes("updated")) return FilePenIcon;
      if (value.includes("restart") || value.includes("restarting")) return RefreshCcwIcon;
      if (value.includes("install") || value.includes("running") || value.includes("command")) return WrenchIcon;
      if (value.includes("read")) return ScrollTextIcon;
      if (value.includes("write")) return FileTextIcon;
      if (value.includes("building") || value.includes("generating")) return SparklesIcon;
      return FileIcon;
    });
  }, [items]);

  return (
    <div className={cn(
      "flex flex-col",
      isStandalone ? "group px-2 pb-4" : "pt-2",
    )}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-3 rounded-2xl px-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <span className="flex size-9 items-center justify-center rounded-xl border bg-muted/60">
            {open ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
          </span>
          <span className="font-medium">
            {open ? "Show less" : "Show more"}
          </span>
          <span className="text-xs text-muted-foreground/70">
            ({items.length})
          </span>
          {isWorking && (
            <span className="ml-auto flex items-center">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border bg-muted/50 text-primary",
                  "animate-pulse shadow-[0_0_14px_rgba(99,102,241,0.5)]"
                )}
              >
                <BrainIcon className="size-4" />
              </span>
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className={cn(
          "mt-3 space-y-2",
          !isStandalone && "pl-1"
        )}>
          <ul className="space-y-2">
            {items.map((item, index) => {
              const Icon = itemIcons[index] ?? FileIcon;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-2xl px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  <span className="mt-0.5 flex size-9 items-center justify-center rounded-xl border bg-background">
                    <Icon className="size-4" />
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
