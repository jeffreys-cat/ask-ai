"use client";

import { Clipboard, Loader2, MessageSquarePlus, Send, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AskStreamEvent, Citation } from "@selectdb/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
}

interface EmbeddedAskWidgetProps {
  projectId?: string;
  organizationId?: string;
  userId?: string;
  title?: string;
  placeholder?: string;
  brand?: string;
  primaryColor?: string;
}

type UIMessageStreamChunk =
  | { type: "text-delta"; delta: string }
  | { type: "data-citations"; data: Citation[] }
  | { type: "data-status"; data: { label: string } }
  | { type: "error"; errorText?: string };

export function EmbeddedAskWidget({
  projectId,
  organizationId,
  userId,
  title = "Ask AI",
  placeholder = "Ask a follow-up",
  brand = "ASK AI",
  primaryColor,
}: EmbeddedAskWidgetProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(!projectId);

  const requestHeaders = useMemo(() => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (organizationId) headers["x-organization-id"] = organizationId;
    if (userId) headers["x-user-id"] = userId;
    return headers;
  }, [organizationId, userId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const canAsk = question.trim().length > 0 && selectedProjectId.length > 0 && !isBusy;

  useEffect(() => {
    if (projectId) return;
    void loadProjects();
  }, [projectId]);

  function closeWidget() {
    window.parent.postMessage({ type: "ask-ai:close" }, "*");
  }

  async function loadProjects() {
    setIsLoadingProjects(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        headers: organizationId || userId ? requestHeaders : undefined,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(payload.projects);
      const firstReady = payload.projects.find((project) => project.status === "ready") ?? payload.projects[0];
      setSelectedProjectId((current) => current || firstReady?.id || "");
      setStatus(firstReady ? "Ready" : "No projects available");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load projects";
      setError(message);
      setStatus(message);
    } finally {
      setIsLoadingProjects(false);
    }
  }

  async function ask() {
    if (!canAsk) return;

    setIsBusy(true);
    setAnswer("");
    setCitations([]);
    setError("");
    setStatus("Searching sources");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          question,
          projectId: selectedProjectId,
          topK: 8,
          includeDebugChunks: false,
        }),
      });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      if (!response.body) throw new Error("No response stream");

      setStatus("Answering");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const line = raw.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            setStatus("Done");
            continue;
          }
          const event = JSON.parse(data) as AskStreamEvent | UIMessageStreamChunk;
          if (event.type === "answer_delta") setAnswer((current) => current + event.delta);
          if (event.type === "text-delta") setAnswer((current) => current + event.delta);
          if (event.type === "citations") setCitations(event.citations);
          if (event.type === "data-citations") setCitations(event.data);
          if (event.type === "data-status") setStatus(event.data.label);
          if (event.type === "done") setStatus("Done");
          if (event.type === "error") {
            const message = "message" in event ? event.message : event.errorText || "Ask failed";
            setStatus(message);
            setError(message);
          }
        }
      }
    } catch (askError) {
      const message = askError instanceof Error ? askError.message : "Ask failed";
      setStatus(message);
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }

  function startNewChat() {
    setQuestion("");
    setAnswer("");
    setCitations([]);
    setError("");
    setStatus("Ready");
  }

  async function copyAnswer() {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setStatus("Copied");
  }

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-black/55 px-3 py-4 sm:px-6">
      <section className="flex h-[min(92vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: primaryColor || undefined }}
            >
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{title}</h1>
              {selectedProject ? <p className="truncate text-xs text-muted-foreground">{selectedProject.name}</p> : null}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={closeWidget} aria-label="Close Ask AI">
            <X className="size-5" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoadingProjects ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading project
            </div>
          ) : (
            <div className="mx-auto flex max-w-none flex-col gap-5">
              {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <article
                className={cn(
                  "min-h-64 whitespace-pre-wrap text-[15px] leading-7",
                  answer ? "text-foreground" : "flex items-center justify-center text-muted-foreground",
                )}
              >
                {answer || (isBusy ? "Generating answer..." : "Ask a question to get an answer with cited sources.")}
              </article>

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button variant="secondary" size="sm" onClick={startNewChat}>
                  <MessageSquarePlus className="size-4" />
                  New chat
                </Button>
                <Button variant="secondary" size="sm" onClick={copyAnswer} disabled={!answer}>
                  <Clipboard className="size-4" />
                  Copy
                </Button>
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" size="sm" disabled={!answer}>
                    <ThumbsUp className="size-4" />
                    Good answer
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!answer}>
                    <ThumbsDown className="size-4" />
                    Bad answer
                  </Button>
                </div>
              </div>

              {citations.length > 0 ? (
                <section className="grid gap-3">
                  <h2 className="text-sm font-semibold">Answer based on the following sources:</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {citations.slice(0, 4).map((citation) => (
                      <a
                        key={citation.id}
                        className="min-h-28 rounded-md border bg-card p-3 text-sm transition-colors hover:bg-accent"
                        href={citation.sourceUri || "#"}
                        target={citation.sourceUri ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        <strong className="line-clamp-2 block leading-5">{citation.title}</strong>
                        <span className="mt-4 flex items-center gap-2 truncate text-muted-foreground">
                          <Sparkles className="size-4 shrink-0 text-primary" />
                          {citation.sourceUri || citation.documentId}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t bg-background px-5 py-4">
          <div className="rounded-lg border bg-background p-3 focus-within:ring-2 focus-within:ring-ring">
            <textarea
              className="min-h-16 w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder={placeholder}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{status}</span>
              <Button size="icon" onClick={ask} disabled={!canAsk} aria-label="Send question">
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Powered by {brand}</span>
            <span>Protected by site policy</span>
          </div>
        </footer>
      </section>
    </main>
  );
}

async function readErrorResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error || payload.message || response.statusText || "Ask failed";
  }
  const text = await response.text();
  return text || response.statusText || "Ask failed";
}
