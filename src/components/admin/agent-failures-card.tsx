"use client";

interface AgentFailureItem {
  id: string;
  errorType: string;
  errorMessage: string | null;
  finishReason: string | null;
  summaryFound: boolean;
  filesCount: number;
  createdAt: string;
  project: {
    id: string;
    name: string;
    userId: string;
    orgId: string | null;
  };
}

interface Props {
  items: AgentFailureItem[];
  title?: string;
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatReason = (item: AgentFailureItem) => {
  if (item.finishReason === "length") {
    return "Output limit";
  }
  if (item.finishReason === "content_filter") {
    return "Safety filter";
  }
  if (item.errorType === "missing_summary") {
    return "Missing summary";
  }
  if (item.errorType === "no_files") {
    return "No files";
  }
  if (item.errorType === "sandbox_limit_reached") {
    return "Sandbox limit";
  }
  if (item.errorType === "tool_call_parse_failed") {
    return "Tool parse";
  }
  if (item.errorType === "agent_error") {
    return "Agent error";
  }
  return "Unknown";
};

export function AgentFailuresCard({
  items,
  title = "Recent Failures",
}: Props) {
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">
          {items.length} recent
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recent failures.
        </p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t align-top">
                  <td className="px-3 py-2">{formatDateTime(item.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.project.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.project.id}
                    </div>
                  </td>
                  <td className="px-3 py-2">{formatReason(item)}</td>
                  <td className="px-3 py-2">
                    {item.errorMessage ? (
                      <div className="text-xs text-muted-foreground">
                        {item.errorMessage}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Summary: {item.summaryFound ? "yes" : "no"} · Files:{" "}
                        {item.filesCount}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Project ID: {item.project.id}
                    </div>
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
