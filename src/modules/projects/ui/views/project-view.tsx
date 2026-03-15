"use client";

import { Suspense, useEffect, useState } from "react";
import { EyeIcon, CodeIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { UserControl } from "@/components/user-control";
import { FileExplorer } from "@/components/file-explorer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Hint } from "@/components/hint";
import { useTRPC } from "@/trpc/client";

import { ElementPickerProvider } from "../components/element-picker-context";
import { FragmentWeb } from "../components/fragment-web";
import { ProjectHeader } from "../components/project-header";
import { MessagesContainer } from "../components/messages-container";
import { ErrorBoundary } from "react-error-boundary";
import { FragmentPreview } from "../types";

interface Props {
  projectId: string;
};

export const ProjectView = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const [activeFragment, setActiveFragment] = useState<FragmentPreview | null>(null);
  const [tabState, setTabState] = useState<"preview" | "code">("preview");
  const canPreview = Boolean(activeFragment?.sandboxUrl);
  const fragmentFilesQuery = useQuery(
    trpc.messages.getFragmentFiles.queryOptions(
      { fragmentId: activeFragment?.id ?? "" },
      {
        enabled: tabState === "code" && Boolean(activeFragment?.id),
      },
    ),
  );

  useEffect(() => {
    if (!activeFragment?.id) return;
    let isActive = true;

    const startSandbox = async () => {
      try {
        const res = await fetch("/api/sandbox/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (!isActive) return;
        if (payload?.sandboxUrl) {
          setActiveFragment((prev) =>
            prev ? { ...prev, sandboxUrl: payload.sandboxUrl } : prev,
          );
        }
      } catch {
        // Best-effort start; ignore failures.
      }
    };

    void startSandbox();

    return () => {
      isActive = false;
    };
  }, [activeFragment?.id, projectId]);

  return (
    <ElementPickerProvider>
      <div className="h-screen">
        <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={35}
          minSize={20}
          className="flex flex-col min-h-0"
        >
          <ErrorBoundary fallback={<p>Project header error</p>}>
            <Suspense fallback={<p>Loading project...</p>}>
              <ProjectHeader projectId={projectId} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary fallback={<p>Messages container error</p>}>
            <Suspense fallback={<p>Loading messages...</p>}>
              <MessagesContainer
                projectId={projectId}
                activeFragment={activeFragment}
                setActiveFragment={setActiveFragment}
              />
            </Suspense>
          </ErrorBoundary>
        </ResizablePanel>
        <ResizableHandle className="hover:bg-primary transition-colors" />
        <ResizablePanel
          defaultSize={65}
          minSize={50}
        >
          <Tabs
            className="h-full gap-y-0"
            defaultValue="preview"
            value={tabState}
            onValueChange={(value) => setTabState(value as "preview" | "code")}
          >
            <div className="w-full h-12 flex items-center px-2 border-b gap-x-2">
              <Hint text="Refresh preview" side="bottom" align="start">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPreview}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("albert:preview-refresh"));
                  }}
                >
                  <RefreshCcwIcon />
                </Button>
              </Hint>
              <TabsList className="h-8 p-0 border rounded-md">
                <TabsTrigger value="preview" className="rounded-md">
                  <EyeIcon /> <span>Demo</span>
                </TabsTrigger>
                <TabsTrigger value="code" className="rounded-md">
                  <CodeIcon /> <span>Code</span>
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto flex items-center gap-x-2">
                <Hint text="Open in new tab" side="bottom" align="start">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canPreview}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("albert:preview-open"));
                    }}
                  >
                    <ExternalLinkIcon />
                  </Button>
                </Hint>
                <UserControl />
              </div>
            </div>
            <TabsContent value="preview">
              {!!activeFragment && <FragmentWeb data={activeFragment} />}
            </TabsContent>
            <TabsContent value="code" className="min-h-0">
              {fragmentFilesQuery.isPending && (
                <div className="p-4 text-sm text-muted-foreground">
                  Loading files...
                </div>
              )}
              {!!fragmentFilesQuery.data?.files && (
                <FileExplorer
                  files={fragmentFilesQuery.data.files as { [path: string]: string }}
                />
              )}
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ElementPickerProvider>
  );
};
