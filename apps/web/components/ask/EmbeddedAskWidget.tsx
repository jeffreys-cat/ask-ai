"use client";

import { Clipboard, Loader2, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState } from "react";
import { ASK_DOC_ANSWER_AGENT, type Citation, type RetrievedChunk } from "@selectdb/shared";
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

type AskDataParts = {
  citations: Citation[];
  retrieved_chunks: RetrievedChunk[];
  session: { id: string };
  status: { label: string };
};

type AskMessage = UIMessage<unknown, AskDataParts>;

export function EmbeddedAskWidget({
  projectId,
  organizationId,
  userId,
  title = "Ask AI",
  placeholder = "Ask a follow-up",
  brand = "Apache Doris",
  primaryColor,
}: EmbeddedAskWidgetProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [, setStatusLabel] = useState("Ready");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(!projectId);

  const requestHeaders = useMemo(() => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (organizationId) headers["x-organization-id"] = organizationId;
    if (userId) headers["x-user-id"] = userId;
    return headers;
  }, [organizationId, userId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AskMessage>({
        api: "/api/ask",
        headers: requestHeaders,
      }),
    [requestHeaders],
  );

  const { messages, sendMessage, stop, status: chatStatus, error: chatError, setMessages, clearError } = useChat<AskMessage>({
    transport,
    experimental_throttle: 60,
    onData: (part) => {
      if (part.type === "data-citations") setCitations(part.data);
      if (part.type === "data-session") setSelectedSessionId(part.data.id);
      if (part.type === "data-status") setStatusLabel(part.data.label);
    },
    onError: (chatError) => {
      setStatusLabel(chatError.message);
      setError(chatError.message);
    },
    onFinish: () => setStatusLabel("Done"),
  });

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const answer = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("") ?? "";
  const isBusy = chatStatus === "submitted" || chatStatus === "streaming";
  const canAsk = selectedProjectId.length > 0 && !isBusy;
  const hasCompletedAnswer = answer.length > 0 && !isBusy;

  useEffect(() => {
    document.documentElement.classList.add("ask-ai-embed-transparent");
    document.body.classList.add("ask-ai-embed-transparent");

    return () => {
      document.documentElement.classList.remove("ask-ai-embed-transparent");
      document.body.classList.remove("ask-ai-embed-transparent");
    };
  }, []);

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
      setStatusLabel(firstReady ? "Ready" : "No projects available");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load projects";
      setError(message);
      setStatusLabel(message);
    } finally {
      setIsLoadingProjects(false);
    }
  }

  async function ask(text: string) {
    if (!text.trim() || !selectedProjectId || isBusy) return;

    setCitations([]);
    setError("");
    clearError();
    setStatusLabel("Searching sources");
    await sendMessage(
      { text },
      {
        body: {
          agentId: ASK_DOC_ANSWER_AGENT.id,
          projectId: selectedProjectId,
          sessionId: selectedSessionId || undefined,
          topK: 3,
          includeDebugChunks: false,
        },
      },
    );
  }

  function startNewChat() {
    setMessages([]);
    setCitations([]);
    setSelectedSessionId("");
    setError("");
    clearError();
    setStatusLabel("Ready");
  }

  async function copyAnswer() {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setStatusLabel("Copied");
  }

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-black/55 px-3 py-4 sm:px-6">
      <section className="flex h-[min(92vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background/95 shadow-2xl backdrop-blur-md supports-[backdrop-filter]:bg-background/90">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background/80 px-5 backdrop-blur">
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

        <PromptInputProvider>
          <Conversation className="px-1">
            {isLoadingProjects ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading project
              </div>
            ) : (
              <ConversationContent className="max-w-none px-4 py-4">
                {error || chatError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error || chatError?.message}
                  </div>
                ) : null}

                {messages.length === 0 ? (
                  <ConversationEmptyState
                    className="min-h-64"
                    icon={<Sparkles className="size-6" />}
                    title={isBusy ? "Generating answer..." : "Ask a question"}
                    description="Answers stream with cited sources from the selected project."
                  />
                ) : (
                  messages.map((message) => <EmbeddedMessageView key={message.id} message={message} />)
                )}

                {isBusy && !answer ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Generating answer...</span>
                  </div>
                ) : null}

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

                {hasCompletedAnswer ? (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button variant="secondary" size="sm" onClick={startNewChat}>
                      <MessageSquarePlus className="size-4" />
                      New chat
                    </Button>
                    <Button variant="secondary" size="sm" onClick={copyAnswer}>
                      <Clipboard className="size-4" />
                      Copy
                    </Button>
                  </div>
                ) : null}
              </ConversationContent>
            )}
          </Conversation>

          <footer className="shrink-0 border-t bg-background/80 px-5 py-4 backdrop-blur">
            <EmbeddedPromptInput
              canAsk={canAsk}
              onStop={stop}
              onSubmit={ask}
              placeholder={placeholder}
              status={chatStatus}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Powered by {brand}</span>
              <span>Protected by site policy</span>
            </div>
          </footer>
        </PromptInputProvider>
      </section>
    </main>
  );
}

function EmbeddedPromptInput({
  canAsk,
  onStop,
  onSubmit,
  placeholder,
  status,
}: {
  canAsk: boolean;
  onStop: () => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
  placeholder: string;
  status: ReturnType<typeof useChat<AskMessage>>["status"];
}) {
  const { textInput } = usePromptInputController();
  const hasText = textInput.value.trim().length > 0;
  const isBusy = status === "submitted" || status === "streaming";

  async function submitAndClear(text: string) {
    const submittedText = text.trim();
    if (!submittedText) return;

    textInput.clear();
    try {
      await onSubmit(submittedText);
    } catch (submitError) {
      textInput.setInput(submittedText);
      throw submitError;
    }
  }

  return (
    <PromptInput onSubmit={({ text }) => submitAndClear(text)}>
      <PromptInputTextarea className="min-h-16 text-sm" placeholder={placeholder} />
      <PromptInputFooter className="flex-row items-center justify-end border-0 px-3 pt-1">
        <PromptInputTools>
          <PromptInputSubmit disabled={(!canAsk || !hasText) && !isBusy} onStop={onStop} status={status} />
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

function EmbeddedMessageView({ message }: { message: AskMessage }) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return (
    <Message from={message.role}>
      <MessageContent className={cn("text-[15px]", message.role === "assistant" ? "w-full max-w-full" : "max-w-[92%]")}>
        <MessageResponse>{text}</MessageResponse>
      </MessageContent>
    </Message>
  );
}
