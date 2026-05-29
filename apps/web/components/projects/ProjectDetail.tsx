"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, Check, Copy, FileCode2, FileUp, Fingerprint, KeyRound, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { AskPanel } from "@/components/ask/AskPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ProjectIngest } from "./ProjectIngest";
import { ProjectIngestNew } from "./ProjectIngestNew";
import { ProjectStatusBadge } from "./status";
import type { ProjectSummary } from "./types";

export function ProjectDetail({ projectId, view }: { projectId: string; view: "overview" | "ingest" | "ingest-new" | "ask" | "api-keys" }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadProject();
  }, [projectId]);

  async function loadProject({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setIsLoading(true);
      setError("");
    }
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { project: ProjectSummary };
      setProject(payload.project);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-6 py-8",
        view === "ask" ? "h-screen min-h-0 max-w-none gap-4 overflow-hidden px-4 py-6 lg:px-6" : "max-w-6xl",
      )}
    >
      {view === "ask" ? null : (
        <ProjectPageHeader project={project} projectId={projectId} view={view} isLoading={isLoading} />
      )}

      <div className="flex gap-2 md:hidden">
        <Button asChild variant={view === "overview" ? "default" : "outline"} size="sm">
          <Link href={`/admin/projects/${projectId}`}>Overview</Link>
        </Button>
        <Button asChild variant={view === "ingest" || view === "ingest-new" ? "default" : "outline"} size="sm">
          <Link href={`/admin/projects/${projectId}/ingest`}>Ingest</Link>
        </Button>
        <Button asChild variant={view === "ask" ? "default" : "outline"} size="sm">
          <Link href={`/admin/projects/${projectId}/ask`}>Ask</Link>
        </Button>
        <Button asChild variant={view === "api-keys" ? "default" : "outline"} size="sm">
          <Link href={`/admin/projects/${projectId}/api-keys`}>API keys</Link>
        </Button>
      </div>

      {view === "ask" ? null : <Separator className="shrink-0" />}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Project request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {view === "overview" ? (
        <ProjectOverview project={project} isLoading={isLoading} projectId={projectId} />
      ) : view === "ingest-new" ? (
        <ProjectIngestNew projectId={projectId} onCreated={loadProject} />
      ) : view === "ask" ? (
        <AskPanel projectId={projectId} className="min-h-0 flex-1" />
      ) : view === "api-keys" ? (
        <ProjectApiKeys projectId={projectId} />
      ) : (
        <ProjectIngest projectId={projectId} onIngested={() => loadProject({ silent: true })} />
      )}
    </div>
  );
}

function ProjectPageHeader({
  project,
  projectId,
  view,
  isLoading,
}: {
  project: ProjectSummary | null;
  projectId: string;
  view: "overview" | "ingest" | "ingest-new" | "api-keys";
  isLoading: boolean;
}) {
  const projectName = project?.name ?? "Project";
  const header = getProjectPageHeader({ projectName, projectDescription: project?.description, view });

  return (
    <header className="shrink-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{header.eyebrow}</p>
          {isLoading && view === "overview" ? <Skeleton className="mt-2 h-8 w-64" /> : <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight">{header.title}</h1>}
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{header.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view === "overview" && !isLoading && project?.status ? <ProjectStatusBadge status={project.status} /> : null}
          {view === "ingest-new" ? (
            <Button asChild variant="outline">
              <Link href={`/admin/projects/${projectId}/ingest`}>
                <ArrowLeft />
                Back
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function getProjectPageHeader({
  projectName,
  projectDescription,
  view,
}: {
  projectName: string;
  projectDescription?: string | null;
  view: "overview" | "ingest" | "ingest-new" | "api-keys";
}) {
  if (view === "overview") {
    return {
      eyebrow: "Project workspace",
      title: projectName,
      description: projectDescription || "Manage project details, ingestion, chatbot testing, and API access.",
    };
  }

  if (view === "ingest-new") {
    return {
      eyebrow: projectName,
      title: "New ingest task",
      description: "Create a background task from a project folder, selected Markdown files, or a sitemap URL.",
    };
  }

  if (view === "api-keys") {
    return {
      eyebrow: projectName,
      title: "API keys",
      description: "Generate project-scoped keys for external search and answer requests.",
    };
  }

  return {
    eyebrow: projectName,
    title: "Ingest tasks",
    description: "Create Markdown ingest jobs and track background progress.",
  };
}

function ProjectOverview({ project, projectId, isLoading }: { project: ProjectSummary | null; projectId: string; isLoading: boolean }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewMetric icon={<ProjectStatusIcon />} label="Status" value={project?.status ?? "unknown"} isLoading={isLoading} />
        <OverviewMetric icon={<CalendarClock className="size-4" />} label="Created" value={formatDate(project?.createdAt)} isLoading={isLoading} />
        <OverviewMetric icon={<CalendarClock className="size-4" />} label="Updated" value={formatDate(project?.updatedAt)} isLoading={isLoading} />
        <OverviewMetric icon={<Fingerprint className="size-4" />} label="Project ID" value={project?.id ?? projectId} isLoading={isLoading} mono />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="bg-background/90">
          <CardHeader className="border-b bg-muted/25">
            <CardTitle>Project setup</CardTitle>
            <CardDescription>Use these actions to move from source content to a searchable chatbot.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
            <Button asChild variant="outline" className="h-auto w-full justify-start gap-3 p-4">
              <Link href={`/admin/projects/${projectId}/ingest`}>
                <FileUp className="size-4" />
                <span className="grid gap-1 text-left">
                  <span>Ingest docs</span>
                  <span className="text-xs font-normal text-muted-foreground">Queue Markdown or sitemap content</span>
                </span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto w-full justify-start gap-3 p-4">
              <Link href={`/admin/projects/${projectId}/ask`}>
                <MessageSquareText className="size-4" />
                <span className="grid gap-1 text-left">
                  <span>Test answers</span>
                  <span className="text-xs font-normal text-muted-foreground">Ask against indexed sources</span>
                </span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto w-full justify-start gap-3 p-4">
              <Link href={`/admin/projects/${projectId}/api-keys`}>
                <KeyRound className="size-4" />
                <span className="grid gap-1 text-left">
                  <span>API access</span>
                  <span className="text-xs font-normal text-muted-foreground">Create project-scoped keys</span>
                </span>
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-background/90">
          <CardHeader>
            <CardTitle>Next step</CardTitle>
            <CardDescription>Index Markdown files before using the chatbot.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href={`/admin/projects/${projectId}/ingest`}>
                <FileUp />
                Open ingest
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <ProjectEmbedPrompt project={project} projectId={projectId} isLoading={isLoading} />
    </div>
  );
}

function ProjectStatusIcon() {
  return <span className="size-2 rounded-full bg-primary" />;
}

function OverviewMetric({ icon, label, value, isLoading, mono = false }: { icon: ReactNode; label: string; value: string; isLoading: boolean; mono?: boolean }) {
  return (
    <Card className="bg-background/85">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {isLoading ? <Skeleton className="mt-2 h-5 w-24" /> : <p className={cn("mt-1 truncate font-medium", mono && "font-mono text-xs")}>{value}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectEmbedPrompt({ project, projectId, isLoading }: { project: ProjectSummary | null; projectId: string; isLoading: boolean }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const embedProjectId = project?.id ?? projectId;
  const title = project?.name ? `${project.name} AI` : "Ask AI";
  const embedCode = buildEmbedCode({
    origin: origin || "https://your-ask-ai-host.example",
    projectId: embedProjectId,
    title,
  });

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function copyEmbedCode() {
    await navigator.clipboard.writeText(embedCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCode2 className="size-5" />
          Embed
        </CardTitle>
        <CardDescription>Paste this code before the closing body tag on the site that should show this project chatbot.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-4 text-xs leading-5">
              <code>{embedCode}</code>
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={copyEmbedCode}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy embed code"}
              </Button>
              <span className="text-xs text-muted-foreground">Project ID: {embedProjectId}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function buildEmbedCode({ origin, projectId, title }: { origin: string; projectId: string; title: string }) {
  return `<script
  src="${escapeHtmlAttribute(origin)}/embed.js"
  data-project-id="${escapeHtmlAttribute(projectId)}"
  data-title="${escapeHtmlAttribute(title)}"
  data-placeholder="Ask anything about our docs..."
  data-primary-color="#087f5b"
  async
></script>`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

interface ProjectApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

function ProjectApiKeys({ projectId }: { projectId: string }) {
  const [keys, setKeys] = useState<ProjectApiKey[]>([]);
  const [name, setName] = useState("production");
  const [newApiKey, setNewApiKey] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    void loadKeys();
  }, [projectId]);

  async function loadKeys() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/api-keys`);
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { keys: ProjectApiKey[] };
      setKeys(payload.keys);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load API keys");
    } finally {
      setIsLoading(false);
    }
  }

  async function createKey() {
    setIsCreating(true);
    setError("");
    setNewApiKey("");
    try {
      const response = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { apiKey: string; key: ProjectApiKey };
      setNewApiKey(payload.apiKey);
      setKeys((current) => [payload.key, ...current]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create API key");
    } finally {
      setIsCreating(false);
    }
  }

  async function revokeKey(keyId: string) {
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/api-keys/${keyId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      await loadKeys();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke API key");
    }
  }

  async function copyKey(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" />
          API keys
        </CardTitle>
        <CardDescription>Generate project-scoped keys for external /api/askai/search calls.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>API key request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {newApiKey ? (
          <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <div>
              <p className="font-medium">Copy this key now. It will not be shown again.</p>
              <code className="mt-2 block break-all rounded-md border bg-background p-3">{newApiKey}</code>
            </div>
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => copyKey(newApiKey)}>
              <Copy className="size-4" />
              Copy key
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Key name" />
          <Button type="button" onClick={createKey} disabled={isCreating}>
            <Plus className="size-4" />
            {isCreating ? "Generating" : "Generate key"}
          </Button>
        </div>

        <div className="grid gap-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : keys.length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">No API keys yet.</div>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{key.name}</span>
                    <code className="rounded bg-muted px-2 py-1 text-xs">
                      {key.keyPrefix}_...{key.keyLast4}
                    </code>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDate(key.createdAt)} · Last used {formatDate(key.lastUsedAt ?? undefined)}
                    {key.revokedAt ? ` · Revoked ${formatDate(key.revokedAt)}` : ""}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => revokeKey(key.id)} disabled={Boolean(key.revokedAt)}>
                  <Trash2 className="size-4" />
                  Revoke
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
