"use client";

import Link from "next/link";
import {
  BookOpenText,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  FileText,
  Loader2,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
} from "lucide-react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState } from "react";
import { ASK_DOC_ANSWER_AGENT, type Citation, type RetrievedChunk } from "@selectdb/shared";
import { cn } from "@/lib/utils";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
}

interface AskSessionSummary {
  id: string;
  userId: string;
  question: string;
  answer?: string | null;
  citations: Citation[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface AskSessionMessage {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

type AskDataParts = {
  citations: Citation[];
  retrieved_chunks: RetrievedChunk[];
  session: { id: string };
  status: { label: string };
};

type AskMessage = UIMessage<unknown, AskDataParts>;

const transport = new DefaultChatTransport<AskMessage>({ api: "/api/ask" });

export function AskPanel({ projectId, className }: { projectId?: string; className?: string }) {
  const isProjectScoped = Boolean(projectId);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const [statusLabel, setStatusLabel] = useState(projectId ? "Loading project" : "Loading projects");
  const [projectError, setProjectError] = useState("");
  const [showContext, setShowContext] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [sessions, setSessions] = useState<AskSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);

  const { messages, sendMessage, stop, status, error, setMessages } = useChat<AskMessage>({
    transport,
    experimental_throttle: 60,
    onData: (part) => {
      if (part.type === "data-citations") setCitations(part.data);
      if (part.type === "data-retrieved_chunks") setChunks(part.data);
      if (part.type === "data-session") setSelectedSessionId(part.data.id);
      if (part.type === "data-status") setStatusLabel(part.data.label);
    },
    onError: (chatError) => setStatusLabel(chatError.message),
    onFinish: () => setStatusLabel("Done"),
  });

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const readyProjects = useMemo(() => projects.filter((project) => project.status === "ready"), [projects]);
  const isBusy = status === "submitted" || status === "streaming";
  const canAsk = selectedProject?.status === "ready" && !isBusy;
  const layoutColumns = isHistoryCollapsed
    ? isEvidenceOpen
      ? "lg:grid-cols-[56px_minmax(0,1fr)] xl:grid-cols-[56px_minmax(0,1fr)_360px]"
      : "lg:grid-cols-[56px_minmax(0,1fr)]"
    : isEvidenceOpen
      ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_360px]"
      : "lg:grid-cols-[280px_minmax(0,1fr)]";
  const activeAnswer = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  useEffect(() => {
    void loadProjects();
  }, [projectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadSessions(selectedProjectId);
  }, [selectedProjectId]);

  async function loadProjects() {
    setIsLoadingProjects(true);
    setProjectError("");
    try {
      if (projectId) {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { project: ProjectSummary };
        setProjects([payload.project]);
        setSelectedProjectId(payload.project.id);
        setStatusLabel(payload.project.status === "ready" ? "Ready" : `Project ${payload.project.status}`);
      } else {
        const response = await fetch("/api/projects");
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { projects: ProjectSummary[] };
        setProjects(payload.projects);
        const firstReady = payload.projects.find((project) => project.status === "ready") ?? payload.projects[0];
        setSelectedProjectId((current) => current || firstReady?.id || "");
        setStatusLabel(firstReady ? "Ready" : "No projects available");
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load projects";
      setProjectError(message);
      setStatusLabel(message);
    } finally {
      setIsLoadingProjects(false);
    }
  }

  async function submitQuestion(text: string) {
    if (!text || !selectedProjectId) return;
    setCitations([]);
    setChunks([]);
    setStatusLabel("Submitting");
    await sendMessage(
      { text },
      {
        body: {
          agentId: ASK_DOC_ANSWER_AGENT.id,
          projectId: selectedProjectId,
          sessionId: selectedSessionId || undefined,
          topK: 8,
          includeDebugChunks: showContext,
        },
      },
    );
    await loadSessions(selectedProjectId);
  }

  function resetConversation() {
    setMessages([]);
    setCitations([]);
    setChunks([]);
    setSelectedSessionId("");
    setStatusLabel(selectedProject ? "Ready" : "No project selected");
  }

  function changeProject(nextProjectId: string) {
    setSelectedProjectId(nextProjectId);
    setMessages([]);
    setCitations([]);
    setChunks([]);
    setSelectedSessionId("");
    setStatusLabel("Ready");
  }

  async function loadSessions(activeProjectId = selectedProjectId) {
    if (!activeProjectId) return;
    setIsLoadingSessions(true);
    try {
      const params = new URLSearchParams({ limit: "50", projectId: activeProjectId });
      const response = await fetch(`/api/ask/sessions?${params.toString()}`);
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { sessions: AskSessionSummary[] };
      setSessions(payload.sessions);
    } catch {
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadSession(sessionId: string) {
    if (isBusy) return;
    setSelectedSessionId(sessionId);
    setStatusLabel("Loading history");
    const response = await fetch(`/api/ask/sessions/${sessionId}`);
    if (!response.ok) {
      setStatusLabel("Failed to load history");
      return;
    }

    const payload = (await response.json()) as {
      session: AskSessionSummary;
      messages: AskSessionMessage[];
    };
    setMessages(
      payload.messages.map((message) => ({
        id: message.id,
        role: message.role as AskMessage["role"],
        parts: [{ type: "text", text: message.content }],
      })),
    );
    setCitations(payload.session.citations);
    setChunks([]);
    setStatusLabel("Viewing history");
  }

  if (isLoadingProjects) {
    return <AskPanelSkeleton projectScoped={isProjectScoped} className={className} />;
  }

  if (projects.length === 0) {
    return (
      <section className={cn("grid min-h-[520px] place-items-center rounded-lg border bg-card px-6 py-12", className)}>
        <div className="max-w-md text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border bg-muted">
            <BookOpenText className="size-5 text-primary" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">No indexed projects</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create a project and ingest Markdown files before asking questions.
          </p>
          <Button asChild className="mt-6">
            <Link href="/admin/projects">Open projects</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={cn("min-h-0 overflow-hidden rounded-lg border bg-card shadow-sm", className ?? "h-[calc(100vh-1.5rem)]")}>
      <div className={cn("grid h-full min-h-0 grid-cols-1", layoutColumns)}>
        <Sidebar className={cn("hidden h-full min-h-0 w-full flex-col border-r bg-muted/30 md:hidden lg:flex", isHistoryCollapsed && "w-14")}>
          <SidebarHeader className={cn("p-3", isHistoryCollapsed && "px-2")}>
            <div className={cn("flex items-center gap-2", isHistoryCollapsed ? "justify-center" : "justify-between")}>
              {isHistoryCollapsed ? null : (
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{isProjectScoped ? "Sessions" : "Ask AI"}</h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {isProjectScoped ? `${sessions.length} conversations` : ASK_DOC_ANSWER_AGENT.name}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-1">
                {!isProjectScoped && !isHistoryCollapsed ? (
                  <Button variant="outline" size="icon" onClick={loadProjects} disabled={isLoadingProjects || isBusy} aria-label="Refresh projects">
                    {isLoadingProjects ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsHistoryCollapsed((current) => !current)}
                  aria-label={isHistoryCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {isHistoryCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                </Button>
              </div>
            </div>
          </SidebarHeader>

          {isHistoryCollapsed ? (
            <SidebarContent className="flex items-center gap-2 p-2">
              <Button variant="ghost" size="icon" onClick={() => setIsHistoryCollapsed(false)} aria-label="Open sessions">
                <Clock3 className="size-4" />
              </Button>
              {!isProjectScoped ? (
                <Button variant="ghost" size="icon" onClick={loadProjects} disabled={isLoadingProjects || isBusy} aria-label="Refresh projects">
                  <RefreshCw className={cn("size-4", isLoadingProjects && "animate-spin")} />
                </Button>
              ) : null}
            </SidebarContent>
          ) : (
            <>
              <SidebarContent className="min-h-0 flex-1 overflow-y-auto p-4">
                {!isProjectScoped ? (
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-2">
                      <Label className="text-xs uppercase tracking-normal text-muted-foreground">Project</Label>
                      <Select value={selectedProjectId} onValueChange={changeProject} disabled={isBusy}>
                        <SelectTrigger className="h-10 bg-background">
                          <SelectValue placeholder="Select a project" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name} {project.status !== "ready" ? `(${project.status})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedProject ? (
                        <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {selectedProject.description || selectedProject.id}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-2">
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => changeProject(project.id)}
                          disabled={isBusy}
                          className={cn(
                            "flex min-h-14 w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition",
                            project.id === selectedProjectId ? "border-primary/40 bg-background shadow-sm" : "bg-transparent hover:bg-background/70",
                          )}
                        >
                          <ProjectStatusIcon status={project.status} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{project.name}</span>
                            <span className="mt-1 block text-xs capitalize text-muted-foreground">{project.status}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <SessionHistory
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  isLoading={isLoadingSessions}
                  onSelect={loadSession}
                  embedded={!isProjectScoped}
                />
              </SidebarContent>

              {!isProjectScoped ? (
                <>
                  <Separator />
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <Metric label="Ready" value={readyProjects.length} />
                      <Metric label="Sources" value={citations.length || chunks.length} />
                    </div>
                    <Button asChild variant="outline" className="mt-4 w-full">
                      <Link href="/admin/projects">Manage projects</Link>
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </Sidebar>

        <main className="flex min-h-0 flex-col overflow-hidden bg-background">
          <header className="shrink-0 flex flex-col gap-3 border-b bg-card px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquareText className="size-4 text-primary" />
                Documentation assistant
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Ask scoped questions and inspect the source trail.</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={statusLabel} busy={isBusy} />
              <Button
                variant={isEvidenceOpen ? "default" : "outline"}
                size="sm"
                onClick={() => setIsEvidenceOpen((current) => !current)}
                aria-pressed={isEvidenceOpen}
              >
                {isEvidenceOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                Evidence
              </Button>
              <Button variant="outline" size="sm" onClick={resetConversation} disabled={isBusy && messages.length === 0}>
                New thread
              </Button>
            </div>
          </header>

          {(projectError || error || readyProjects.length === 0) ? (
            <div className="shrink-0 px-5 pt-4">
              <Alert variant={projectError || error ? "destructive" : "default"}>
                <CircleAlert className="size-4" />
                <AlertTitle>{projectError || error ? "Request failed" : "No ready projects yet"}</AlertTitle>
                <AlertDescription>
                  {projectError || error?.message || "Ingest Markdown files from Projects before asking questions."}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          <PromptInputProvider>
            <Conversation>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<Bot className="size-6" />}
                  title="Ask your indexed documentation"
                  description={isProjectScoped ? "Ask a precise question and citations will appear beside the streamed answer." : "Select a ready project, ask a precise question, and citations will appear beside the streamed answer."}
                >
                  <div className="max-w-xl">
                    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-lg border bg-card shadow-sm text-primary">
                      <Bot className="size-6" />
                    </div>
                    <h3 className="text-2xl font-semibold tracking-tight">Ask your indexed documentation</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {isProjectScoped
                        ? "Ask a precise question and citations will appear beside the streamed answer."
                        : "Select a ready project, ask a precise question, and citations will appear beside the streamed answer."}
                    </p>
                    <SuggestedQuestionGrid />
                  </div>
                </ConversationEmptyState>
              ) : (
                <ConversationContent className="mx-auto w-full max-w-5xl">
                  {messages.map((message) => (
                    <AskMessageView key={message.id} message={message} />
                  ))}
                  {isBusy && !activeAnswer ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Preparing answer
                    </div>
                  ) : null}
                </ConversationContent>
              )}
            </Conversation>

            <footer className="shrink-0 border-t bg-card p-4">
              <div className="mx-auto w-full max-w-5xl">
                <AskPromptInput
                  canAsk={canAsk}
                  includeDebugChunks={showContext}
                  onIncludeDebugChunksChange={setShowContext}
                  onSubmit={submitQuestion}
                  onStop={stop}
                  status={status}
                />
              </div>
            </footer>
          </PromptInputProvider>
        </main>

        {isEvidenceOpen ? (
          <>
            <aside className="hidden min-h-0 overflow-hidden border-l bg-muted/20 xl:block">
              <ContextInspector citations={citations} chunks={chunks} onClose={() => setIsEvidenceOpen(false)} />
            </aside>

            <section className="max-h-[min(520px,calc(100vh-1.5rem))] overflow-hidden border-t bg-muted/20 xl:hidden">
              <ContextInspector citations={citations} chunks={chunks} compact onClose={() => setIsEvidenceOpen(false)} />
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}

function AskPanelSkeleton({ projectScoped = false, className }: { projectScoped?: boolean; className?: string }) {
  return (
    <section
      className={cn(
        "grid min-h-0 grid-cols-1 overflow-hidden rounded-lg border bg-card",
        className ?? "min-h-[calc(100vh-3rem)]",
        projectScoped ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]"
      )}
    >
      {projectScoped ? (
        <div className="hidden border-r p-4 lg:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 grid gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <div className="border-r p-4">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 grid gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        </div>
      )}
      <div className="p-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-6 h-80 w-full" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    </section>
  );
}

function ProjectStatusIcon({ status }: { status: string }) {
  if (status === "ready") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />;
  if (status === "failed") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SessionHistory({
  sessions,
  selectedSessionId,
  isLoading,
  onSelect,
  embedded = false,
}: {
  sessions: AskSessionSummary[];
  selectedSessionId: string;
  isLoading: boolean;
  onSelect: (sessionId: string) => void;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "grid gap-3 border-t pt-5" : "flex h-full min-h-0 flex-col"}>
      <div className={embedded ? "flex items-center justify-between gap-3" : "shrink-0 border-b p-4"}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock3 className="size-4 text-primary" />
          Sessions
        </div>
        <Badge variant="outline" className="tabular-nums">{sessions.length}</Badge>
      </div>

      <div className={embedded ? "grid gap-2" : "min-h-0 flex-1 overflow-y-auto p-3"}>
        {isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="rounded-md border border-dashed bg-background px-3 py-4 text-xs leading-5 text-muted-foreground">
            No sessions yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                className={cn(
                  "min-h-16 rounded-md border bg-background px-3 py-2 text-left transition hover:border-primary/40",
                  selectedSessionId === session.id && "border-primary/50 shadow-sm",
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-5">{session.question}</span>
                <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{shortUserId(session.userId)}</span>
                  <span className="shrink-0">{formatSessionTime(session.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, busy }: { status: string; busy: boolean }) {
  return (
    <div className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground">
      {busy ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <span className="size-2 rounded-full bg-primary" />}
      {status}
    </div>
  );
}

function shortUserId(userId: string) {
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 6)}...${userId.slice(-4)}`;
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function SuggestedQuestionGrid() {
  const { textInput } = usePromptInputController();

  return (
    <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
      {["Summarize the deployment steps.", "Which config keys are required?", "Where is authentication described?", "Compare the documented ingest modes."].map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => textInput.setInput(item)}
          className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function AskPromptInput({
  canAsk,
  includeDebugChunks,
  onIncludeDebugChunksChange,
  onSubmit,
  onStop,
  status,
}: {
  canAsk: boolean;
  includeDebugChunks: boolean;
  onIncludeDebugChunksChange: (value: boolean) => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  status: ReturnType<typeof useChat<AskMessage>>["status"];
}) {
  const { textInput } = usePromptInputController();
  const hasText = textInput.value.trim().length > 0;
  const isBusy = status === "submitted" || status === "streaming";

  return (
    <PromptInput
      onSubmit={({ text }) => {
        const submitted = onSubmit(text);
        textInput.clear();
        return submitted;
      }}
    >
      <PromptInputTextarea placeholder="Ask about configuration, APIs, setup steps, or anything in this project..." />
      <PromptInputFooter>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={includeDebugChunks}
            onChange={(event) => onIncludeDebugChunksChange(event.target.checked)}
          />
          Stream retrieved chunks
        </label>
        <PromptInputTools className="justify-end">
          <PromptInputSubmit disabled={(!canAsk || !hasText) && !isBusy} onStop={onStop} status={status} />
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

function AskMessageView({ message }: { message: AskMessage }) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return (
    <Message from={message.role}>
      <MessageContent>
        <MessageResponse>{text}</MessageResponse>
      </MessageContent>
    </Message>
  );
}

function ContextInspector({
  citations,
  chunks,
  compact = false,
  onClose,
}: {
  citations: Citation[];
  chunks: RetrievedChunk[];
  compact?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? "max-h-[520px]" : ""}`}>
      <div className="shrink-0 border-b bg-card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <PanelRightOpen className="size-4 text-primary" />
              Evidence
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Citations and retrieved source chunks.</p>
          </div>
          {onClose ? (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Collapse evidence">
              <PanelRightClose className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-5">
          <InspectorGroup
            icon={<BookOpenText className="size-4" />}
            title="Citations"
            empty="No citations yet."
            count={citations.length}
          >
            {citations.map((citation) => (
              <article key={citation.id} className="rounded-md border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      [{citation.id}] {citation.title}
                    </div>
                    {citation.sourceUri ? <div className="mt-1 truncate text-xs text-muted-foreground">{citation.sourceUri}</div> : null}
                  </div>
                  {citation.score === undefined ? null : (
                    <span className="text-xs tabular-nums text-muted-foreground">{citation.score.toFixed(3)}</span>
                  )}
                </div>
                <p className="mt-3 line-clamp-5 text-xs leading-5 text-muted-foreground">{citation.excerpt}</p>
              </article>
            ))}
          </InspectorGroup>

          <InspectorGroup
            icon={<FileText className="size-4" />}
            title="Retrieved chunks"
            empty="Enable chunk streaming before asking."
            count={chunks.length}
          >
            {chunks.map((chunk) => (
              <article key={chunk.chunkId} className="rounded-md border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{chunk.title ?? chunk.documentId}</div>
                    {chunk.sourceUri ? <div className="mt-1 truncate text-xs text-muted-foreground">{chunk.sourceUri}</div> : null}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{chunk.score.toFixed(3)}</span>
                </div>
                <p className="mt-3 line-clamp-6 text-xs leading-5 text-muted-foreground">{chunk.content}</p>
              </article>
            ))}
          </InspectorGroup>
        </div>
      </div>
    </div>
  );
}

function InspectorGroup({
  icon,
  title,
  empty,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-primary">{icon}</span>
          {title}
        </div>
        <Badge variant="outline" className="tabular-nums">{count}</Badge>
      </div>
      <div className="grid gap-3">
        {count === 0 ? <p className="rounded-md border border-dashed bg-background px-3 py-4 text-sm text-muted-foreground">{empty}</p> : children}
      </div>
    </section>
  );
}
