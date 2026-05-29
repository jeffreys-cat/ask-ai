"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, FolderOpen, Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ProjectStatusBadge } from "./status";
import type { ProjectSummary } from "./types";

export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(payload.projects);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load projects");
    } finally {
      setIsLoading(false);
    }
  }

  async function createProject() {
    setIsCreating(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { project: ProjectSummary };
      setIsDialogOpen(false);
      setName("");
      setDescription("");
      router.push(`/admin/projects/${payload.project.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create project failed");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-5 rounded-lg border bg-background/80 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create documentation projects, monitor indexing, and open the right project workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadProjects} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Create project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
                <DialogDescription>Use a project to group Markdown and MDX files from one docs site.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Name</Label>
                  <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Product Docs" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="project-description">Description</Label>
                  <Textarea
                    id="project-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Public docs, internal docs, or a Nextra/Fumadocs project."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>
                  Cancel
                </Button>
                <Button onClick={createProject} disabled={name.trim().length === 0 || isCreating}>
                  {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <ProjectStats projects={projects} isLoading={isLoading} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Project request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden bg-background/90">
        <CardHeader className="border-b bg-muted/25">
          <CardTitle>Project list</CardTitle>
          <CardDescription>Open a project to view details, ingest documents, or manage API keys.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="grid gap-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : projects.length === 0 ? (
            <div className="m-6 flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 text-center">
              <FolderOpen className="mb-3 h-9 w-9 text-muted-foreground" />
              <p className="font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a project before ingesting Markdown files.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-24 pr-6 text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id} className="hover:bg-muted/30">
                    <TableCell className="pl-6 font-medium">
                      <div className="grid gap-1">
                        <Link className="w-fit underline-offset-4 hover:underline" href={`/admin/projects/${project.id}`}>
                          {project.name}
                        </Link>
                        <span className="max-w-72 truncate text-xs font-normal text-muted-foreground">{project.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground">
                      <span className="line-clamp-2">{project.description || "No description"}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(project.updatedAt)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/projects/${project.id}`}>
                          Open
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function ProjectStats({ projects, isLoading }: { projects: ProjectSummary[]; isLoading: boolean }) {
  const readyCount = projects.filter((project) => project.status === "ready").length;
  const activeCount = projects.filter((project) => project.status === "ingesting" || project.status === "queued").length;
  const failedCount = projects.filter((project) => project.status === "failed").length;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={<FolderOpen className="size-4" />} label="Total projects" value={projects.length} isLoading={isLoading} />
      <StatCard icon={<CheckCircle2 className="size-4" />} label="Ready" value={readyCount} isLoading={isLoading} />
      <StatCard icon={<Clock3 className="size-4" />} label="Indexing" value={activeCount} isLoading={isLoading} />
      <StatCard icon={<TriangleAlert className="size-4" />} label="Needs attention" value={failedCount} isLoading={isLoading} />
    </section>
  );
}

function StatCard({ icon, label, value, isLoading }: { icon: ReactNode; label: string; value: number; isLoading: boolean }) {
  return (
    <Card className="bg-background/85">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          {isLoading ? <Skeleton className="mt-2 h-7 w-12" /> : <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>}
        </div>
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
