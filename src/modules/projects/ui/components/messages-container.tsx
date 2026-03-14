import { useEffect, useRef } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { FragmentPreview } from "../types";

import { MessageCard } from "./message-card";
import { MessageForm } from "./message-form";
import { MessageLoading } from "./message-loading";
import { ProgressGroup } from "./progress-group";

interface Props {
  projectId: string;
  activeFragment: FragmentPreview | null;
  setActiveFragment: (fragment: FragmentPreview | null) => void;
};

export const MessagesContainer = ({ 
  projectId,
  activeFragment,
  setActiveFragment
}: Props) => {
  const trpc = useTRPC();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const lastAssistantFragmentRef = useRef<{
    id: string;
    updatedAt: string;
    sandboxUrl: string | null;
  } | null>(null);
  const lastWakeFragmentIdRef = useRef<string | null>(null);

  const { data: messages } = useSuspenseQuery(trpc.messages.getMany.queryOptions({
    projectId: projectId,
  }, {
    refetchInterval: 2000,
  }));

  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "USER") {
        return i;
      }
    }
    return -1;
  })();

  const lastAssistantResultIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === "ASSISTANT" && message.type === "RESULT") {
        return i;
      }
    }
    return -1;
  })();

  const hasCompletedRun = lastAssistantResultIndex > lastUserIndex;

  useEffect(() => {
    const latestFragmentMessage = messages.findLast(
      (message) => message.fragment
    );

    const fragmentId = latestFragmentMessage?.fragment?.id;
    if (!fragmentId || fragmentId === lastWakeFragmentIdRef.current) {
      return;
    }

    lastWakeFragmentIdRef.current = fragmentId;

    fetch("/api/sandbox/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fragmentId }),
    }).catch(() => {
      // Best-effort wake on load; ignore failures.
    });
  }, [messages]);

  useEffect(() => {
    const lastAssistantMessage = messages.findLast(
      (message) => message.role === "ASSISTANT" && Boolean(message.fragment)
    );

    if (!lastAssistantMessage?.fragment) {
      return;
    }

    const fragment = lastAssistantMessage.fragment;
    const fragmentUpdatedAt = fragment.updatedAt
      ? new Date(fragment.updatedAt).toISOString()
      : "";
    const prev = lastAssistantFragmentRef.current;
    const isSameFragment = prev?.id === fragment.id;
    const hasFragmentChanged =
      !isSameFragment ||
      prev?.updatedAt !== fragmentUpdatedAt ||
      prev?.sandboxUrl !== fragment.sandboxUrl;

    const isNewResult =
      lastAssistantMessage.id !== lastAssistantMessageIdRef.current;

    const shouldSelectLatest =
      isNewResult ||
      !activeFragment ||
      (activeFragment.id === fragment.id && hasFragmentChanged);

    if (shouldSelectLatest) {
      setActiveFragment(fragment);
    }

    lastAssistantMessageIdRef.current = lastAssistantMessage.id;
    lastAssistantFragmentRef.current = {
      id: fragment.id,
      updatedAt: fragmentUpdatedAt,
      sandboxUrl: fragment.sandboxUrl ?? null,
    };
  }, [activeFragment, messages, setActiveFragment]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  const lastMessage = messages[messages.length - 1];
  const isLastMessageUser = lastMessage?.role === "USER";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pt-2 pr-1">
          {(() => {
            const rendered: React.ReactNode[] = [];
            let pendingProgress: Array<{ id: string; content: string }> | null = null;

            for (let i = 0; i < messages.length; i += 1) {
              const message = messages[i];
              if (message.type === "PROGRESS") {
                const startIndex = i;
                let endIndex = i;
                while (
                  endIndex < messages.length &&
                  messages[endIndex].type === "PROGRESS"
                ) {
                  endIndex += 1;
                }

                const items = messages.slice(startIndex, endIndex).map((item) => ({
                  id: item.id,
                  content: item.content,
                }));
                const hasNextMessage = endIndex < messages.length;

                if (hasNextMessage) {
                  pendingProgress = items;
                } else {
                  rendered.push(
                    <ProgressGroup
                      key={`progress-${messages[startIndex]?.id ?? startIndex}`}
                      items={items}
                      isComplete={hasCompletedRun}
                    />,
                  );
                }

                i = endIndex - 1;
                continue;
              }

              if (pendingProgress && message.role !== "ASSISTANT") {
                rendered.push(
                  <ProgressGroup
                    key={`progress-${message.id}-standalone`}
                    items={pendingProgress}
                    isComplete={true}
                  />,
                );
                pendingProgress = null;
              }

              rendered.push(
                <MessageCard
                  key={message.id}
                  content={message.content}
                  role={message.role}
                  fragment={message.fragment}
                  createdAt={message.createdAt}
                  isActiveFragment={activeFragment?.id === message.fragment?.id}
                  onFragmentClick={() => setActiveFragment(message.fragment)}
                  type={message.type}
                  progressItems={message.role === "ASSISTANT" ? pendingProgress ?? undefined : undefined}
                />
              );
              pendingProgress = null;
            }

            if (pendingProgress) {
              rendered.push(
                <ProgressGroup
                  key="progress-trailing"
                  items={pendingProgress}
                  isComplete={true}
                />,
              );
            }

            return rendered;
          })()}
          {isLastMessageUser && <MessageLoading />}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-background pointer-events-none" />
        <MessageForm projectId={projectId} />
      </div>
    </div>
  );
};
