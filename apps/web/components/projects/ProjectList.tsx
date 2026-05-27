"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Plus, RefreshCw } from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">Create documentation projects and manage Markdown ingestion.</p>
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

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Project request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Project list</CardTitle>
          <CardDescription>Open a project to view details or ingest Markdown files.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
              <FolderOpen className="mb-3 h-9 w-9 text-muted-foreground" />
              <p className="font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a project before ingesting Markdown files.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-20 text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground">{project.description || "No description"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(project.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/projects/${project.id}`}>Open</Link>
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

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
