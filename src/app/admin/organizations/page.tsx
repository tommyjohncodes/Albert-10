"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);
const formatMinutes = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

export default function AdminOrganizationsPage() {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.admin.listOrganizations.queryOptions({
      limit: 100,
      offset: 0,
    })
  );
  const { data, isPending, isFetching } = query;

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading organizations...</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={isFetching}
        >
          <RefreshCcw className={isFetching ? "animate-spin" : ""} />
          {isFetching ? "Refreshing..." : "Refresh Active Sandboxes"}
        </Button>
      </div>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Members</th>
              <th className="px-3 py-2 text-left">Active Sandboxes</th>
              <th className="px-3 py-2 text-left">Provider / Model</th>
              <th className="px-3 py-2 text-left">OpenRouter Key</th>
              <th className="px-3 py-2 text-left">Total Tokens</th>
              <th className="px-3 py-2 text-left">Sandbox Minutes</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((org) => (
              <tr key={org.id} className="border-t">
                <td className="px-3 py-2">
                  <Link className="underline underline-offset-4" href={`/admin/organizations/${org.id}`}>
                    {org.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{org.membersCount}</td>
                <td className="px-3 py-2">{formatNumber(org.activeSandboxes)}</td>
                <td className="px-3 py-2">
                  {org.provider ? `${org.provider} / ${org.model}` : "Not configured"}
                </td>
                <td className="px-3 py-2">{org.hasOpenRouterKey ? "Configured" : "Not set"}</td>
                <td className="px-3 py-2">{formatNumber(org.usage.totalTokens)}</td>
                <td className="px-3 py-2">{formatMinutes(org.sandboxUsage.totalMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
