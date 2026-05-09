"use client";

import Link from "next/link";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AskStreamEvent, Citation, RetrievedChunk } from "@selectdb/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CitationList } from "./CitationList";
import { RetrievedChunks } from "./RetrievedChunks";

interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
}

export function AskPanel() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const [status, setStatus] = useState("Loading projects");
  const [error, setError] = useState("");
  const [debug, setDebug] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const readyProjects = useMemo(() => projects.filter((project) => project.status === "ready"), [projects]);
  const canAsk = question.trim().length > 0 && selectedProject?.status === "ready" && !isBusy;

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    setIsLoadingProjects(true);
    setError("");
    try {
      const response = await fetch("/api/projects");
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
    setIsBusy(true);
    setAnswer("");
    setCitations([]);
    setChunks([]);
    setError("");
    setStatus("Retrieving context");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          projectId: selectedProjectId,
          topK: 8,
          includeDebugChunks: debug,
        }),
      });
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
          const event = JSON.parse(line.slice(5).trim()) as AskStreamEvent;
          if (event.type === "answer_delta") setAnswer((current) => current + event.delta);
          if (event.type === "retrieved_chunks") setChunks(event.chunks);
          if (event.type === "citations") setCitations(event.citations);
          if (event.type === "done") setStatus("Done");
          if (event.type === "error") {
            setStatus(event.message);
            setError(event.message);
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

  return (
    <div className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isLoadingProjects ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No indexed projects</CardTitle>
            <CardDescription>Create a project and ingest Markdown files before asking questions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/projects">Open projects</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Ask a project</CardTitle>
            <CardDescription>Questions are scoped to the selected project's ready Markdown documents.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label>Project</Label>
              <div className="flex gap-2">
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={isBusy}>
                  <SelectTrigger>
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
                <Button variant="outline" size="icon" onClick={loadProjects} disabled={isLoadingProjects || isBusy} aria-label="Refresh projects">
                  {isLoadingProjects ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
              </div>
              {selectedProject ? <p className="text-sm text-muted-foreground">{selectedProject.description || selectedProject.id}</p> : null}
              {readyProjects.length === 0 ? <p className="text-sm text-destructive">No ready projects yet. Ingest Markdown files from Projects first.</p> : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="question">Question</Label>
              <Textarea
                id="question"
                className="min-h-28"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What does this project say about configuration?"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
                Show retrieved chunks
              </label>
              <Button disabled={!canAsk} onClick={ask}>
                {isBusy ? <Loader2 className="animate-spin" /> : <Send />}
                Ask
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <span>{status}</span>
            </div>

            <article className="min-h-48 whitespace-pre-wrap rounded-lg border bg-background p-4 text-sm leading-7">
              {answer || "The answer stream will appear here."}
            </article>
          </CardContent>
        </Card>
      )}

      <CitationList citations={citations} />
      <RetrievedChunks chunks={chunks} />
    </div>
  );
}
