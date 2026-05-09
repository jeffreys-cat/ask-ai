"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IngestResult } from "./types";

export function ProjectIngest({ projectId, onIngested }: { projectId: string; onIngested?: () => void | Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<IngestResult[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const markdownFiles = useMemo(() => files.filter((file) => /\.(md|mdx)$/i.test(relativePath(file))), [files]);
  const ignoredCount = files.length - markdownFiles.length;
  const canIngest = markdownFiles.length > 0 && !isBusy;

  async function ingestProject() {
    setIsBusy(true);
    setError("");
    setResults([]);
    setStatus(`Ingesting ${markdownFiles.length} Markdown files`);
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
      const payload = (await response.json()) as {
        fileCount: number;
        completedCount: number;
        failedCount: number;
        results: IngestResult[];
      };
      setResults(payload.results);
      setStatus(`Ingested ${payload.completedCount}/${payload.fileCount} files${payload.failedCount ? `, ${payload.failedCount} failed` : ""}`);
      await onIngested?.();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Ingest failed");
      setStatus("Ingest failed");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Ingest failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ingest Markdown project</CardTitle>
          <CardDescription>Upload a docs directory or select Markdown/MDX files. Directory paths are preserved as source paths.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="project-directory">Project directory</Label>
            <Input
              id="project-directory"
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is supported by Chromium/WebKit for folder uploads.
              webkitdirectory=""
              accept=".md,.mdx,text/markdown,text/mdx"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="markdown-files">Markdown files</Label>
            <Input
              id="markdown-files"
              type="file"
              multiple
              accept=".md,.mdx,text/markdown,text/mdx"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{markdownFiles.length} Markdown/MDX files selected</span>
            {ignoredCount > 0 ? <span>{ignoredCount} non-Markdown files ignored</span> : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{status}</p>
            <Button onClick={ingestProject} disabled={!canIngest}>
              {isBusy ? <Loader2 className="animate-spin" /> : <FileUp />}
              Upload and ingest
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent ingestion</CardTitle>
          <CardDescription>Results are shown for the latest upload in this browser session.</CardDescription>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Upload Markdown files to see per-file ingestion results.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result) => (
                  <TableRow key={`${result.ingestionId}:${result.sourcePath}`}>
                    <TableCell className="max-w-md break-all font-medium">{result.sourcePath}</TableCell>
                    <TableCell>{result.status}</TableCell>
                    <TableCell>{result.chunkCount ?? "-"}</TableCell>
                    <TableCell className="max-w-md break-words text-destructive">{result.error ? summarizeError(result.error) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function relativePath(file: File) {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, "/");
}

function summarizeError(error: string) {
  if (error.includes("Connection lost")) return "Connection lost while writing chunks. Retry this file.";
  if (error.includes("batch size is invalid")) return "Embedding batch was too large. Retry after the latest batching fix.";
  if (error.includes("input.texts should not be null")) return "No embeddable text was found. Retry after the latest empty-document fix.";
  return error.length > 240 ? `${error.slice(0, 240)}...` : error;
}
