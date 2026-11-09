"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RunDialog } from "@/components/run-dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/pill";
import { Empty, ErrorNote, PageHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { get } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtInt, fmtRelative } from "@/lib/format";
import type { RunSummary } from "@/lib/types";

const FILTERS = {
  all: "",
  active: "queued,running",
  approval: "awaiting_approval",
  failed: "failed,timed_out",
  succeeded: "succeeded",
} as const;
type Filter = keyof typeof FILTERS;
const PAGE = 30;

export default function RunsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [runOpen, setRunOpen] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ["runs", "list", filter],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (FILTERS[filter]) p.set("status", FILTERS[filter]);
      if (pageParam) p.set("before", pageParam);
      return get<RunSummary[]>(`/runs?${p}`);
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].queued_at : undefined),
    refetchInterval: 10_000,
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Runs"
        sub="Every execution, newest first. Open a run to follow it live or replay its events."
        actions={
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => setRunOpen(true)}>
            New run
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter runs"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "approval", label: "Needs approval" },
            { value: "failed", label: "Failed" },
            { value: "succeeded", label: "Succeeded" },
          ]}
        />
        {q.data && <p className="num text-[12px] text-muted">{fmtInt(rows.length)}{q.hasNextPage ? "+" : ""} runs</p>}
      </div>
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[42px] w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title={filter === "all" ? "No runs yet" : "No runs match this filter"}
          body={filter === "all" ? "Start a run from any workflow. It shows up here the moment it is queued." : "Try another filter."}
          action={filter === "all" ? <Button size="sm" variant="primary" onClick={() => setRunOpen(true)}>Start a run</Button> : undefined}
        />
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-hidden rounded-[var(--radius-card)] panel md:block">
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="h-10 w-[150px] px-5 font-normal">Status</th>
                  <th className="w-[200px] font-normal">Workflow</th>
                  <th className="font-normal">Task</th>
                  <th className="w-[130px] font-normal">Started</th>
                  <th className="w-[100px] text-right font-normal">Duration</th>
                  <th className="w-[110px] px-5 text-right font-normal">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group relative border-t border-rule transition-colors hover:bg-white/[0.02]">
                    <td className="h-[var(--row)] px-5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="truncate pr-4">
                      <Link href={`/app/runs/${r.id}`} className="font-medium after:absolute after:inset-0 hover:text-accent-ink">
                        {r.workflow_name}
                      </Link>
                    </td>
                    <td className="truncate pr-6 text-muted">{r.input.task}</td>
                    <td className="text-muted" title={fmtDateTime(r.queued_at)}>
                      {fmtRelative(r.queued_at)}
                    </td>
                    <td className="num text-right">{fmtDuration(r.duration_ms)}</td>
                    <td className="num px-5 text-right">{r.tokens_in + r.tokens_out ? fmtInt(r.tokens_in + r.tokens_out) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* phone: two-line rows */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/runs/${r.id}`} className="panel block rounded-[var(--radius-card)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[14px] font-medium">{r.workflow_name}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <p className="mt-1 truncate text-[13px] text-muted">
                    {fmtRelative(r.queued_at)} · {fmtDuration(r.duration_ms)} · {r.input.task}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                Load older runs
              </Button>
            </div>
          )}
        </>
      )}
      <RunDialog open={runOpen} onClose={() => setRunOpen(false)} />
    </div>
  );
}
