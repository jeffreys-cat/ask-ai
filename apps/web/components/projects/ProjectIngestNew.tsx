"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type IngestSource = "folder" | "markdown";

export function ProjectIngestNew({ projectId, onCreated }: { projectId: string; onCreated?: () => void | Promise<void> }) {
  const router = useRouter();
  const [source, setSource] = useState<IngestSource>("folder");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const markdownFiles = useMemo(() => files.filter((file) => /\.(md|mdx)$/i.test(relativePath(file))), [files]);
  const ignoredCount = files.length - markdownFiles.length;
  const canCreate = markdownFiles.length > 0 && !isCreating;

  async function createIngestTask() {
    setIsCreating(true);
    setError("");
    setStatus(`Creating ingest task for ${markdownFiles.length} Markdown files`);
    try {
      const form = new FormData();
      for (const file of markdownFiles) {
        form.append("files", file, relativePath(file));
      }

      const response = await fetch(`/api/projects/${projectId}/ingest`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { fileCount: number };
      setStatus(`Ingest task created: ${payload.fileCount} files queued`);
      await onCreated?.();
      router.push(`/admin/projects/${projectId}/ingest`);
      router.refresh();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Failed to create ingest task");
      setStatus("Ingest task creation failed");
    } finally {
      setIsCreating(false);
    }
  }

  function selectSource(nextSource: IngestSource) {
    setSource(nextSource);
    setFiles([]);
    setStatus("Ready");
    setError("");
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Ingest error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>New ingest task</CardTitle>
            <CardDescription>Create a background task from a project folder or selected Markdown files.</CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href={`/admin/projects/${projectId}/ingest`}>
              <ArrowLeft />
              Back
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-6">
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">Source</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="ingest-source"
                  value="folder"
                  checked={source === "folder"}
                  onChange={() => selectSource("folder")}
                  className="mt-1"
                />
                <span className="grid gap-1">
                  <span className="font-medium">Project Folder</span>
                  <span className="text-sm text-muted-foreground">Upload a docs directory and preserve nested source paths.</span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="ingest-source"
                  value="markdown"
                  checked={source === "markdown"}
                  onChange={() => selectSource("markdown")}
                  className="mt-1"
                />
                <span className="grid gap-1">
                  <span className="font-medium">Markdown file</span>
                  <span className="text-sm text-muted-foreground">Select one or more Markdown/MDX files directly.</span>
                </span>
              </label>
            </div>
          </fieldset>

          {source === "folder" ? (
            <div className="grid gap-2">
              <Label htmlFor="project-directory">Project Folder</Label>
              <Input
                key="project-directory"
                id="project-directory"
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is supported by Chromium/WebKit for folder uploads.
                webkitdirectory=""
                accept=".md,.mdx,text/markdown,text/mdx"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="markdown-files">Markdown file</Label>
              <Input
                key="markdown-files"
                id="markdown-files"
                type="file"
                multiple
                accept=".md,.mdx,text/markdown,text/mdx"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{markdownFiles.length} Markdown/MDX files selected</span>
            {ignoredCount > 0 ? <span>{ignoredCount} non-Markdown files ignored</span> : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{status}</p>
            <Button onClick={createIngestTask} disabled={!canCreate}>
              {isCreating ? <Loader2 className="animate-spin" /> : <FileUp />}
              Create task
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function relativePath(file: File) {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, "/");
}
