"use client";

import Link from "next/link";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IngestTask } from "./types";

const TASKS_PER_PAGE = 10;

export function ProjectIngest({ projectId, onIngested }: { projectId: string; onIngested?: () => void | Promise<void> }) {
  const [tasks, setTasks] = useState<IngestTask[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastHadActiveTaskRef = useRef(false);

  const hasActiveTask = tasks.some((task) => task.status === "queued" || task.status === "running");
  const pageCount = Math.max(1, Math.ceil(tasks.length / TASKS_PER_PAGE));
  const visibleTasks = tasks.slice((page - 1) * TASKS_PER_PAGE, page * TASKS_PER_PAGE);

  const loadTasks = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setIsRefreshing(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/ingest`, { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { tasks: IngestTask[] };
        setTasks(payload.tasks);
        setError("");
        return payload.tasks;
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load ingest tasks");
        return null;
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadTasks().then((nextTasks) => {
      if (nextTasks) lastHadActiveTaskRef.current = hasActiveTasks(nextTasks);
    });
  }, [loadTasks]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!hasActiveTask) return;
    const timer = window.setInterval(() => {
      void loadTasks({ silent: true }).then((nextTasks) => {
        if (!nextTasks) return;
        const nextHasActiveTask = hasActiveTasks(nextTasks);
        const completedActiveTask = lastHadActiveTaskRef.current && !nextHasActiveTask;
        lastHadActiveTaskRef.current = nextHasActiveTask;
        if (completedActiveTask) void onIngested?.();
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, loadTasks, onIngested]);

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Ingest error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => loadTasks()} disabled={isRefreshing}>
          {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
        <Button asChild>
          <Link href={`/admin/projects/${projectId}/ingest/new`}>
            <Plus />
            New
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-6">
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No ingest tasks yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(task.createdAt)}</TableCell>
                    <TableCell>
                      <TaskStatusBadge status={task.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">files {task.processedCount}/{task.fileCount}</TableCell>
                    <TableCell className="min-w-72">
                      <div className="max-h-28 overflow-auto text-xs text-muted-foreground">
                        {task.files.map((file) => (
                          <div key={file.ingestionId} className="flex gap-2 py-0.5">
                            <span className="w-20 shrink-0">{file.status}</span>
                            <span className="break-all">{file.sourcePath}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{task.chunkCount}</TableCell>
                    <TableCell className="max-w-xs break-words text-destructive">{task.failedCount > 0 ? summarizeTaskErrors(task) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {tasks.length > TASKS_PER_PAGE ? (
          <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * TASKS_PER_PAGE + 1}-{Math.min(page * TASKS_PER_PAGE, tasks.length)} of {tasks.length}
            </p>
            <TaskPagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}

function TaskPagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  const pages = paginationPages(page, pageCount);

  return (
    <Pagination className="mx-0 w-auto">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious disabled={page === 1} onClick={() => onPageChange(Math.max(1, page - 1))} />
        </PaginationItem>
        {pages.map((item, index) => (
          <PaginationItem key={`${item}-${index}`}>
            {item === "ellipsis" ? (
              <PaginationEllipsis />
            ) : (
              <PaginationLink isActive={item === page} onClick={() => onPageChange(item)}>
                {item}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext disabled={page === pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function paginationPages(page: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) pages.push("ellipsis");
  for (let nextPage = start; nextPage <= end; nextPage += 1) pages.push(nextPage);
  if (end < pageCount - 1) pages.push("ellipsis");
  pages.push(pageCount);
  return pages;
}

function hasActiveTasks(tasks: IngestTask[]) {
  return tasks.some((task) => task.status === "queued" || task.status === "running");
}

function TaskStatusBadge({ status }: { status: string }) {
  const variant = status === "failed" || status === "completed_with_errors" ? "destructive" : status === "completed" ? "default" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function summarizeTaskErrors(task: IngestTask) {
  const failedFile = task.files.find((file) => file.error);
  if (!failedFile?.error) return `${task.failedCount} failed`;
  const summary = summarizeError(failedFile.error);
  return task.failedCount > 1 ? `${summary} (${task.failedCount} failed)` : summary;
}

function summarizeError(error: string) {
  if (error.includes("Connection lost")) return "Connection lost while writing chunks. Retry this file.";
  if (error.includes("batch size is invalid")) return "Embedding batch was too large. Retry after the latest batching fix.";
  if (error.includes("input.texts should not be null")) return "No embeddable text was found. Retry after the latest empty-document fix.";
  return error.length > 240 ? `${error.slice(0, 240)}...` : error;
}
