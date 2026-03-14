"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ActiveSandboxesCard } from "@/components/admin/active-sandboxes-card";
import { UsageCharts } from "@/components/admin/usage-charts";
import { useTRPC } from "@/trpc/client";

const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);
const formatMinutes = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const trpc = useTRPC();

  const { data, isPending } = useQuery(
    trpc.admin.getUser.queryOptions({
      userId: params.userId,
    })
  );

  if (isPending || !data) {
    return <p className="text-sm text-muted-foreground">Loading user...</p>;
  }

  const name = [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") || data.user.email || data.user.id;

  return (
    <section className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <Link href="/admin" className="underline underline-offset-4">
          Admin Portal
        </Link>{" "}
        / {name}
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p className="text-sm text-muted-foreground">{data.user.email ?? data.user.id}</p>
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
        <h2 className="text-lg font-semibold">Organization memberships</h2>
        {data.memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No organization memberships.</p>
        ) : (
          <div className="space-y-2">
            {data.memberships.map((membership) => (
              <div key={`${membership.organizationId}-${membership.role}`} className="flex justify-between text-sm">
                <Link className="underline underline-offset-4" href={`/admin/organizations/${membership.organizationId}`}>
                  {membership.organizationName}
                </Link>
                <span className="text-muted-foreground">{membership.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
