"use client";

import type { Citation } from "@selectdb/shared";

export function SourcePreview({ citation }: { citation: Citation }) {
  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">[{citation.id}]</span>
          <strong className="text-sm">{citation.title}</strong>
        </div>
        {citation.score === undefined ? null : <em className="text-xs not-italic text-muted-foreground">{citation.score.toFixed(4)}</em>}
      </div>
      {citation.sourceUri ? <em className="mt-2 block break-all text-xs not-italic text-muted-foreground">{citation.sourceUri}</em> : null}
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{citation.excerpt}</p>
    </article>
  );
}
