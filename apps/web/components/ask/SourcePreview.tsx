"use client";

import type { Citation } from "@selectdb/shared";

export function SourcePreview({ citation }: { citation: Citation }) {
  return (
    <article className="source-preview">
      <div className="source-head">
        <span>[{citation.id}]</span>
        <strong>{citation.title}</strong>
        {citation.score === undefined ? null : <em>{citation.score.toFixed(4)}</em>}
      </div>
      <p>{citation.excerpt}</p>
    </article>
  );
}
