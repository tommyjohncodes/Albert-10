"use client";

import Link from "next/link";

interface ActiveSandboxItem {
  sandboxId: string;
  sandboxUrl: string | null;
  projectId: string;
  projectName: string;
  lastActiveAt: string;
  createdAt: string;
}

interface Props {
  items: ActiveSandboxItem[];
  title?: string;
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function ActiveSandboxesCard({
  items,
  title = "Active Sandboxes",
}: Props) {
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">
          {items.length} active
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active sandboxes.
        </p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Sandbox ID</th>
                <th className="px-3 py-2 text-left">Last Active</th>
                <th className="px-3 py-2 text-left">Started</th>
                <th className="px-3 py-2 text-left">Preview</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.sandboxId} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.projectName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.projectId}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{item.sandboxId}</td>
                  <td className="px-3 py-2">{formatDateTime(item.lastActiveAt)}</td>
                  <td className="px-3 py-2">{formatDateTime(item.createdAt)}</td>
                  <td className="px-3 py-2">
                    {item.sandboxUrl ? (
                      <Link
                        href={item.sandboxUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        Open
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
