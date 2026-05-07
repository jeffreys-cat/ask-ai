"use client";

import { FileUp, Send, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CitationList } from "./CitationList";
import { RetrievedChunks } from "./RetrievedChunks";
import type { AskStreamEvent, Citation, RetrievedChunk } from "@selectdb/shared";
import "./ask.css";

export function AskPanel() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const [status, setStatus] = useState("Ready");
  const [debug, setDebug] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const canUpload = useMemo(() => title.trim().length > 0 && content.trim().length > 0 && !isBusy, [title, content, isBusy]);
  const canAsk = useMemo(() => question.trim().length > 0 && !isBusy, [question, isBusy]);

  async function uploadDocument() {
    setIsBusy(true);
    setStatus("Creating document");
    try {
      const documentResponse = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, sourceType: "upload", mimeType: "text/markdown" }),
      });
      if (!documentResponse.ok) throw new Error(await documentResponse.text());
      const documentPayload = (await documentResponse.json()) as { documentId: string };
      setDocumentId(documentPayload.documentId);

      setStatus("Ingesting document");
      const ingestResponse = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: documentPayload.documentId,
          content,
          mimeType: "text/markdown",
        }),
      });
      if (!ingestResponse.ok) throw new Error(await ingestResponse.text());
      setStatus("Document ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function ask() {
    setIsBusy(true);
    setAnswer("");
    setCitations([]);
    setChunks([]);
    setStatus("Retrieving context");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          documentIds: documentId ? [documentId] : undefined,
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
          if (event.type === "error") setStatus(event.message);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ask failed");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="ask-grid">
      <section className="panel input-panel">
        <div className="panel-title">
          <FileUp size={18} />
          <h2>Document</h2>
        </div>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Q2 Product Brief" />
        </label>
        <label>
          Content
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste markdown, HTML text, or plain text for the first version."
          />
        </label>
        <button className="primary-button" disabled={!canUpload} onClick={uploadDocument}>
          {isBusy ? <Loader2 className="spin" size={16} /> : <FileUp size={16} />}
          Upload and ingest
        </button>
        <div className="status-row">
          <span>{status}</span>
          {documentId ? <code>{documentId}</code> : null}
        </div>
      </section>

      <section className="panel answer-panel">
        <div className="panel-title">
          <Send size={18} />
          <h2>Ask</h2>
        </div>
        <label>
          Question
          <textarea
            className="question-box"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What does this document say about launch risks?"
          />
        </label>
        <div className="toolbar-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
            Show retrieved chunks
          </label>
          <button className="primary-button" disabled={!canAsk} onClick={ask}>
            {isBusy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            Ask
          </button>
        </div>
        <article className="answer-box">{answer || "The answer stream will appear here."}</article>
        <CitationList citations={citations} />
      </section>

      <RetrievedChunks chunks={chunks} />
    </div>
  );
}
