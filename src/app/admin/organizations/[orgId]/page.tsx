"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { ActiveSandboxesCard } from "@/components/admin/active-sandboxes-card";
import { UsageCharts } from "@/components/admin/usage-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);
const formatMinutes = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

const fallbackModels = ["z-ai/glm-5", "openai/gpt-4o", "anthropic/claude-3.5-sonnet"];

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery(
    trpc.admin.getOrganization.queryOptions({
      orgId,
    })
  );
  const { data: modelData, isPending: isModelsPending } = useQuery(
    trpc.admin.listOpenRouterModels.queryOptions()
  );

  const [model, setModel] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [titleModel, setTitleModel] = useState("");
  const [responseModel, setResponseModel] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");

  const mutation = useMutation(
    trpc.admin.updateOrgSettings.mutationOptions({
      onSuccess: async () => {
        toast.success("Organization settings updated");
        await queryClient.invalidateQueries(trpc.admin.getOrganization.queryOptions({ orgId }));
        await queryClient.invalidateQueries(trpc.admin.listOrganizations.queryOptions({ limit: 100, offset: 0 }));
      },
      onError: (error) => toast.error(error.message),
    })
  );

  useEffect(() => {
    if (!data) return;
    setModel(data.settings.model || "");
    setTitleModel(data.settings.titleModel || "");
    setResponseModel(data.settings.responseModel || "");
  }, [data]);

  const modelOptions = useMemo(() => {
    const remoteModels =
      modelData?.models?.length && modelData.models.length > 0
        ? modelData.models.map((modelItem) => ({
            id: modelItem.id,
            name: modelItem.name ?? modelItem.id,
          }))
        : fallbackModels.map((modelItem) => ({
            id: modelItem,
            name: modelItem,
          }));

    if (model && !remoteModels.some((item) => item.id === model)) {
      return [{ id: model, name: model }, ...remoteModels];
    }

    return remoteModels;
  }, [modelData, model]);

  const selectedModelLabel = useMemo(() => {
    if (!model) return "Select model";
    return modelOptions.find((item) => item.id === model)?.name ?? model;
  }, [modelOptions, model]);

  useEffect(() => {
    if (!model && modelOptions.length > 0) {
      setModel(modelOptions[0].id);
    }
  }, [model, modelOptions]);

  if (isPending || !data) {
    return <p className="text-sm text-muted-foreground">Loading organization...</p>;
  }

  const onSave = async () => {
    await mutation.mutateAsync({
      orgId,
      provider: "openrouter",
      model: model || modelOptions[0]?.id || "",
      titleModel: titleModel || undefined,
      responseModel: responseModel || undefined,
      openrouterApiKey: openrouterApiKey || undefined,
    });
    setOpenrouterApiKey("");
  };

  return (
    <section className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <Link href="/admin" className="underline underline-offset-4">
          Admin Portal
        </Link>{" "}
        / {data.organization.name}
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{data.organization.name}</h1>
        <p className="text-sm text-muted-foreground">{data.organization.id}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Organization LLM Settings</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Model</label>
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={modelOpen}
                  className="w-full justify-between"
                >
                  <span className="truncate">
                    {isModelsPending ? "Loading models..." : selectedModelLabel}
                  </span>
                  <ChevronsUpDownIcon className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search models..." />
                  <CommandList>
                    <CommandEmpty>
                      {isModelsPending ? "Loading models..." : "No models found."}
                    </CommandEmpty>
                    <CommandGroup>
                      {modelOptions.map((modelOption) => (
                        <CommandItem
                          key={modelOption.id}
                          value={modelOption.id}
                          keywords={[modelOption.name]}
                          onSelect={(value) => {
                            setModel(value);
                            setModelOpen(false);
                          }}
                        >
                          <CheckIcon
                            className={cn(
                              "mr-2 size-4",
                              model === modelOption.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="truncate">{modelOption.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Title model (optional)</label>
            <Input value={titleModel} onChange={(e) => setTitleModel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Response model (optional)</label>
            <Input value={responseModel} onChange={(e) => setResponseModel(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">OpenRouter API key (encrypted per org)</label>
            <Badge variant={data.settings.hasOpenRouterKey ? "secondary" : "outline"}>
              {data.settings.hasOpenRouterKey ? "Key set" : "Not set"}
            </Badge>
          </div>
          <Input
            type="password"
            placeholder={data.settings.hasOpenRouterKey ? "Leave blank to keep current key" : "Enter OpenRouter key"}
            value={openrouterApiKey}
            onChange={(e) => setOpenrouterApiKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Submit empty value to keep existing key. Set a new value to update encrypted org key.
          </p>
        </div>

        <Button disabled={mutation.isPending} onClick={onSave}>
          {mutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Total tokens</p>
          <p className="text-2xl font-semibold">{formatNumber(data.usage.totals.totalTokens)}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Prompt tokens</p>
          <p className="text-2xl font-semibold">{formatNumber(data.usage.totals.promptTokens)}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Completion tokens</p>
          <p className="text-2xl font-semibold">{formatNumber(data.usage.totals.completionTokens)}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Sandbox minutes</p>
          <p className="text-2xl font-semibold">{formatMinutes(data.sandboxUsage.totals.totalMinutes)}</p>
        </div>
      </div>

      <ActiveSandboxesCard items={data.activeSandboxes} />

      <UsageCharts
        daily={data.usage.daily}
        byProvider={data.usage.byProvider}
        byModel={data.usage.byModel}
      />

      <div className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Members</h2>
        <div className="space-y-2">
          {data.members.map((member) => (
            <div key={member.id || `${member.identifier}-${member.role}`} className="flex justify-between text-sm">
              <span>{member.firstName || member.lastName ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() : member.identifier || "Unknown user"}</span>
              <span className="text-muted-foreground">{member.role}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
