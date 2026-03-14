"use client";

import { BarChart3Icon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  className?: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatMinutes = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

export const UserMetrics = ({ className }: Props) => {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.usage.metrics.queryOptions());

  const llmCost = data?.llmCostUsd ?? 0;
  const sandboxMinutes = data?.sandboxMinutes ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Usage metrics"
          className={cn(
            "flex size-8 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            className
          )}
        >
          <BarChart3Icon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-2">
        <DropdownMenuLabel>Usage</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-2 px-2 py-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">LLM cost</span>
            <span className="font-medium text-foreground">
              {isPending ? "…" : formatCurrency(llmCost)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Sandbox minutes</span>
            <span className="font-medium text-foreground">
              {isPending ? "…" : `${formatMinutes(sandboxMinutes)}m`}
            </span>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
