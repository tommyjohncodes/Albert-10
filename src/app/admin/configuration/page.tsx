"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function AdminConfigurationPage() {
  const [token, setToken] = useState("");
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
    </section>
  );
}
