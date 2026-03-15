"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type ProgressSection = {
  id: string;
  title: string | null;
  doneText: string | null;
  items: Array<{ id: string; content: string }>;
};

const isStepStart = (value: string) => value.toLowerCase().startsWith("step:");
const isStepDone = (value: string) =>
  value.toLowerCase().startsWith("done:") ||
  value.toLowerCase().startsWith("completed:");

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

  const { actionItems, sections } = useMemo(() => {
    const actionItems = items.filter(
      (item) => !isStepStart(item.content) && !isStepDone(item.content),
    );

    const sections: ProgressSection[] = [];
    let current: ProgressSection = {
      id: items[0]?.id ?? "initial",
      title: null,
      doneText: null,
      items: [],
    };

    for (const item of items) {
      if (isStepStart(item.content)) {
        if (current.title || current.items.length > 0 || current.doneText) {
          sections.push(current);
        }
        current = {
          id: item.id,
          title: item.content.replace(/^step:\s*/i, "").trim() || "Step",
          doneText: null,
          items: [],
        };
        continue;
      }
      if (isStepDone(item.content)) {
        current.doneText = item.content
          .replace(/^(done|completed):\s*/i, "")
          .trim();
        continue;
      }
      current.items.push(item);
    }

    if (current.title || current.items.length > 0 || current.doneText) {
      sections.push(current);
    }

    return { actionItems, sections };
  }, [items]);

  const iconForItem = useCallback((item: { content: string }) => {
    const value = item.content.toLowerCase();
    if (value.includes("planning")) return BrainIcon;
    if (value.includes("ran command") || value.includes("command")) return TerminalIcon;
    if (value.includes("opened") || value.includes("read")) return BookOpenIcon;
    if (value.includes("created")) return FilePlusIcon;
    if (value.includes("edited") || value.includes("updated")) return FilePenIcon;
    if (value.includes("restart") || value.includes("restarting")) return RefreshCcwIcon;
    return FileTextIcon;
  }, []);

  const actionIcons = useMemo(
    () => actionItems.map((item) => iconForItem(item)),
    [actionItems, iconForItem],
  );

  const actionPreview = actionIcons.slice(0, 4);
  const remainingActions = Math.max(actionItems.length - actionPreview.length, 0);

  const renderActionRow = (icons: Array<typeof BrainIcon>, total: number) => {
    const preview = icons.slice(0, 4);
    const remaining = Math.max(total - preview.length, 0);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {preview.map((Icon, index) => (
            <span
              key={`section-action-${index}`}
              className="flex size-6 items-center justify-center rounded-lg border bg-background"
            >
              <Icon className="size-3.5" />
            </span>
          ))}
          {remaining > 0 && (
            <span className="px-1 text-[10px] font-medium">+{remaining}</span>
          )}
        </span>
        <span>{total} actions</span>
      </div>
    );
  };

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
                <span className="px-1 text-[10px] font-medium">+{remainingActions}</span>
              )}
            </span>
            <span>{actionItems.length} actions</span>
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
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                Working
                <span className="inline-flex items-center">
                  <span className="w-0 overflow-hidden animate-[ellipsis_1.2s_steps(4,end)_infinite]">
                    ...
                  </span>
                </span>
              </span>
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-4">
          {sections.map((section) => {
            const sectionIcons = section.items.map((item) => iconForItem(item));
            const hasActions = section.items.length > 0;
            return (
              <div key={section.id} className="space-y-2">
                {section.title && (
                  <p className="text-sm font-medium text-foreground">
                    {section.title}
                  </p>
                )}
                {hasActions && renderActionRow(sectionIcons, section.items.length)}
                {hasActions && (
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const Icon = iconForItem(item) ?? FileTextIcon;
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
                )}
                {section.doneText && (
                  <p className="text-xs text-muted-foreground">
                    {section.doneText}
                  </p>
                )}
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
