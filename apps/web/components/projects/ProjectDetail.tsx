"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, FileUp, Home, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectStatusBadge } from "./status";
import { ProjectIngest } from "./ProjectIngest";
import type { ProjectSummary } from "./types";

export function ProjectDetail({ projectId, view }: { projectId: string; view: "overview" | "ingest" }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadProject();
  }, [projectId]);

  async function loadProject() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { project: ProjectSummary };
      setProject(payload.project);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 justify-start">
            <Link href="/admin/projects">
              <ArrowLeft />
              Projects
            </Link>
          </Button>
          <div className="mt-4 min-w-0">
            <p className="truncate text-sm font-semibold">{project?.name ?? "Project"}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{projectId}</p>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuButton href={`/admin/projects/${projectId}`} isActive={view === "overview"}>
              <Home className="h-4 w-4" />
              Overview
            </SidebarMenuButton>
            <SidebarMenuButton href={`/admin/projects/${projectId}/ingest`} isActive={view === "ingest"}>
              <FileUp className="h-4 w-4" />
              Ingest
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
          <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              {isLoading ? <Skeleton className="h-8 w-64" /> : <h1 className="truncate text-3xl font-semibold tracking-tight">{project?.name ?? "Project"}</h1>}
              <p className="mt-2 text-sm text-muted-foreground">{project?.description || "Manage project details and ingestion."}</p>
            </div>
            <div className="flex items-center gap-2">
              {project ? <ProjectStatusBadge status={project.status} /> : <Badge variant="secondary">loading</Badge>}
              <Button variant="outline" size="sm" onClick={loadProject} disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin" /> : null}
                Refresh
              </Button>
            </div>
          </header>

          <div className="flex gap-2 md:hidden">
            <Button asChild variant={view === "overview" ? "default" : "outline"} size="sm">
              <Link href={`/admin/projects/${projectId}`}>Overview</Link>
            </Button>
            <Button asChild variant={view === "ingest" ? "default" : "outline"} size="sm">
              <Link href={`/admin/projects/${projectId}/ingest`}>Ingest</Link>
            </Button>
          </div>

          <Separator />

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Project request failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {view === "overview" ? <ProjectOverview project={project} isLoading={isLoading} projectId={projectId} /> : <ProjectIngest projectId={projectId} onIngested={loadProject} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ProjectOverview({ project, projectId, isLoading }: { project: ProjectSummary | null; projectId: string; isLoading: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Project metadata and current ingestion state.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {isLoading ? (
            <>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/3" />
            </>
          ) : (
            <>
              <InfoRow label="Project ID" value={project?.id ?? projectId} />
              <InfoRow label="Status" value={project?.status ?? "unknown"} />
              <InfoRow label="Created" value={formatDate(project?.createdAt)} />
              <InfoRow label="Updated" value={formatDate(project?.updatedAt)} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
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
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border p-3 sm:grid-cols-[120px_1fr] sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
