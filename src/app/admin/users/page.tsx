"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";

const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);

export default function AdminUsersPage() {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(
    trpc.admin.listUsers.queryOptions({
      limit: 100,
      offset: 0,
    })
  );

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading users...</p>;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">User ID</th>
              <th className="px-3 py-2 text-left">Total Tokens</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="px-3 py-2">
                  <Link className="underline underline-offset-4" href={`/admin/users/${user.id}`}>
                    {user.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{user.email ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{user.id}</td>
                <td className="px-3 py-2">{formatNumber(user.usage.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
