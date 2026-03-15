import Image from "next/image";
import { format } from "date-fns";
import { CheckCircle2Icon, ChevronRightIcon, Code2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { MessageRole, MessageType } from "@/generated/prisma";
import { FragmentPreview } from "../types";
import { ProgressGroup } from "./progress-group";

interface UserMessageProps {
  content: string;
}

const UserMessage = ({ content }: UserMessageProps) => {
  return (
    <div className="flex justify-end pb-4 pr-2 pl-10">
      <Card className="rounded-lg bg-muted p-3 shadow-none border-none max-w-[80%] break-words">
        {content}
      </Card>
    </div>
  );
}

interface FragmentCardProps {
  fragment: FragmentPreview;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: FragmentPreview) => void;
};

const FragmentCard = ({
  fragment,
  isActiveFragment,
  onFragmentClick,
}: FragmentCardProps) => {
  return (
    <button
      className={cn(
        "flex items-start text-start gap-1.5 border rounded-md bg-muted w-fit px-2 py-1.5 hover:bg-secondary transition-colors",
        isActiveFragment && 
          "bg-primary text-primary-foreground border-primary hover:bg-primary",
      )}
      onClick={() => onFragmentClick(fragment)}
    >
      <Code2Icon className="size-3.5 mt-0.5" />
      <div className="flex flex-col flex-1 gap-1">
        <span className="text-xs font-semibold line-clamp-1">
          {fragment.title}
        </span>
        <div
          className={cn(
            "flex items-center gap-1 text-xs",
            isActiveFragment
              ? "text-primary-foreground/80"
              : "text-emerald-600",
          )}
        >
          <CheckCircle2Icon className="size-3" />
          <span>Task complete</span>
        </div>
      </div>
      <div className="flex items-center justify-center mt-0.5">
        <ChevronRightIcon className="size-3.5" />
      </div>
    </button>
  );
};

interface AssistantMessageProps {
  content: string;
  fragment: FragmentPreview | null;
  createdAt: Date;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: FragmentPreview) => void;
  type: MessageType;
  progressItems?: Array<{ id: string; content: string }>;
};

type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const stripMarkdownEmphasis = (text: string) =>
  text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

const parseAssistantContent = (content: string): ContentBlock[] => {
  const lines = content.split(/\r?\n/);
  const blocks: ContentBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
    }
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const match = line.match(/^(?:[-*]\s*)?✅\s*(.+)$/);
    if (match) {
      flushParagraph();
      listItems.push(stripMarkdownEmphasis(match[1].trim()));
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  if (blocks.length === 0) {
    return [{ type: "paragraph", text: content }];
  }

  return blocks;
};

const AssistantMessage = ({
  content,
  fragment,
  createdAt,
  isActiveFragment,
  onFragmentClick,
  type,
  progressItems,
}: AssistantMessageProps) => {
  return (
    <div className={cn(
      "flex flex-col group px-2 pb-4",
      type === "ERROR" && "text-red-700 dark:text-red-500",
    )}>
      <div className="flex items-center gap-2 pl-2 mb-2">
        <Image
          src="/albert-logo.png"
          alt="Albert"
          width={18}
          height={18}
          className="shrink-0"
        />
        <span className="text-sm font-medium">Albert</span>
        <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {format(createdAt, "HH:mm 'on' MMM dd, yyyy")}
        </span>
      </div>
      <div className="pl-8.5 flex flex-col gap-y-4">
        <div className="space-y-3">
          {parseAssistantContent(content).map((block, index) => {
            if (block.type === "list") {
              return (
                <ul key={`list-${index}`} className="space-y-2">
                  {block.items.map((item, itemIndex) => (
                    <li key={`item-${index}-${itemIndex}`} className="flex items-start gap-2">
                      <span className="mt-0.5">✅</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              );
            }

            return (
              <p key={`para-${index}`} className="whitespace-pre-line leading-relaxed">
                {block.text}
              </p>
            );
          })}
        </div>
        {progressItems && progressItems.length > 0 && (
          <ProgressGroup
            items={progressItems}
            isComplete={true}
            variant="embedded"
          />
        )}
        {fragment && type === "RESULT" && (
          <FragmentCard
            fragment={fragment}
            isActiveFragment={isActiveFragment}
            onFragmentClick={onFragmentClick}
          />
        )}
      </div>
    </div>
  )
};

interface MessageCardProps {
  content: string;
  role: MessageRole;
  fragment: FragmentPreview | null;
  createdAt: Date;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: FragmentPreview) => void;
  type: MessageType;
  progressItems?: Array<{ id: string; content: string }>;
};

export const MessageCard = ({
  content,
  role,
  fragment,
  createdAt,
  isActiveFragment,
  onFragmentClick,
  type,
  progressItems,
}: MessageCardProps) => {
  if (role === "ASSISTANT") {
    return (
      <AssistantMessage
        content={content}
        fragment={fragment}
        createdAt={createdAt}
        isActiveFragment={isActiveFragment}
        onFragmentClick={onFragmentClick}
        type={type}
        progressItems={progressItems}
      />
    )
  }

  return (
    <UserMessage content={content} />
  );
};
