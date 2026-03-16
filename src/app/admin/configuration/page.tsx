"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/trpc/client";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function AdminConfigurationPage() {
  const [token, setToken] = useState("");
  const [efficiencyEnabled, setEfficiencyEnabled] = useState(false);
  const [agentHistoryLimit, setAgentHistoryLimit] = useState("4");
  const [contextSummaryMaxChars, setContextSummaryMaxChars] = useState("900");
  const [agentTimeoutMs, setAgentTimeoutMs] = useState("240000");
  const [responseTimeoutMs, setResponseTimeoutMs] = useState("30000");
  const [contextTimeoutMs, setContextTimeoutMs] = useState("15000");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery(trpc.admin.getPlatformSettings.queryOptions());

  const mutation = useMutation(
    trpc.admin.upsertVercelToken.mutationOptions({
      onSuccess: async () => {
        toast.success("Configuration updated");
        setToken("");
        await queryClient.invalidateQueries(trpc.admin.getPlatformSettings.queryOptions());
      },
      onError: (error) => toast.error(error.message),
    })
  );

  const efficiencyMutation = useMutation(
    trpc.admin.updateTokenEfficiencySettings.mutationOptions({
      onSuccess: async () => {
        toast.success("Token efficiency settings updated");
        await queryClient.invalidateQueries(trpc.admin.getPlatformSettings.queryOptions());
      },
      onError: (error) => toast.error(error.message),
    })
  );

  useEffect(() => {
    if (!data) return;
    setEfficiencyEnabled(Boolean(data.tokenEfficiencyMode));
    setAgentHistoryLimit(String(data.agentHistoryLimit ?? 4));
    setContextSummaryMaxChars(String(data.contextSummaryMaxChars ?? 900));
    setAgentTimeoutMs(String(data.agentTimeoutMs ?? 240000));
    setResponseTimeoutMs(String(data.responseTimeoutMs ?? 30000));
    setContextTimeoutMs(String(data.contextTimeoutMs ?? 15000));
  }, [data]);

  const toNumber = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  if (isPending || !data) {
    return <p className="text-sm text-muted-foreground">Loading configuration...</p>;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">Platform-wide admin settings.</p>
      </div>

      <div className="rounded-xl border p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Vercel token</span>
          <span className="text-muted-foreground">{data.hasToken ? "Configured" : "Not set"}</span>
        </div>
        <div className="flex justify-between">
          <span>Token updated</span>
          <span className="text-muted-foreground">{formatDate(data.tokenUpdatedAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>Encryption key</span>
          <span className="text-muted-foreground">{data.encryptionReady ? "Configured" : "Missing"}</span>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <label className="text-sm font-medium">Vercel personal access token</label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={data.hasToken ? "Enter a new token or leave blank to clear" : "Enter token"}
        />
        <p className="text-xs text-muted-foreground">Submit empty value to clear saved token.</p>
        <Button
          onClick={() =>
            mutation.mutate({
              token,
            })
          }
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving..." : "Save Vercel token"}
        </Button>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Token efficiency mode</p>
            <p className="text-xs text-muted-foreground">
              Applies strict limits to reduce prompt size and runtime.
            </p>
          </div>
          <Switch checked={efficiencyEnabled} onCheckedChange={setEfficiencyEnabled} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">History limit</label>
            <Input
              type="number"
              min={1}
              max={20}
              value={agentHistoryLimit}
              onChange={(e) => setAgentHistoryLimit(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Summary max chars</label>
            <Input
              type="number"
              min={300}
              max={3000}
              value={contextSummaryMaxChars}
              onChange={(e) => setContextSummaryMaxChars(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Agent timeout (ms)</label>
            <Input
              type="number"
              min={0}
              max={600000}
              value={agentTimeoutMs}
              onChange={(e) => setAgentTimeoutMs(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Response timeout (ms)</label>
            <Input
              type="number"
              min={0}
              max={120000}
              value={responseTimeoutMs}
              onChange={(e) => setResponseTimeoutMs(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Context timeout (ms)</label>
            <Input
              type="number"
              min={0}
              max={120000}
              value={contextTimeoutMs}
              onChange={(e) => setContextTimeoutMs(e.target.value)}
            />
          </div>
        </div>

        <Button
          onClick={() =>
            efficiencyMutation.mutate({
              enabled: efficiencyEnabled,
              agentHistoryLimit: toNumber(agentHistoryLimit, 4),
              contextSummaryMaxChars: toNumber(contextSummaryMaxChars, 900),
              agentTimeoutMs: toNumber(agentTimeoutMs, 240000),
              responseTimeoutMs: toNumber(responseTimeoutMs, 30000),
              contextTimeoutMs: toNumber(contextTimeoutMs, 15000),
            })
          }
          disabled={efficiencyMutation.isPending}
        >
          {efficiencyMutation.isPending ? "Saving..." : "Save token efficiency settings"}
        </Button>
      </div>
    </section>
  );
}
