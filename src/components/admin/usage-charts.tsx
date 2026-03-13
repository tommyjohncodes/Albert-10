"use client";

import { BarChart, Bar, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsagePoint {
  label: string;
  totalTokens: number;
}

interface DailyUsagePoint extends UsagePoint {
  promptTokens: number;
  completionTokens: number;
}

interface Props {
  daily: DailyUsagePoint[];
  byProvider: UsagePoint[];
  byModel: UsagePoint[];
}

const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);

export function UsageCharts({ daily, byProvider, byModel }: Props) {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily Token Usage (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          {daily.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No usage data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={formatNumber} />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Line type="monotone" dataKey="totalTokens" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usage by Provider</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {byProvider.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No provider usage yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byProvider}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={formatNumber} />
                  <Tooltip formatter={(value) => formatNumber(Number(value))} />
                  <Bar dataKey="totalTokens" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage by Model</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {byModel.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No model usage yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byModel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={formatNumber} />
                  <YAxis dataKey="label" type="category" width={160} />
                  <Tooltip formatter={(value) => formatNumber(Number(value))} />
                  <Bar dataKey="totalTokens" fill="#16a34a" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
