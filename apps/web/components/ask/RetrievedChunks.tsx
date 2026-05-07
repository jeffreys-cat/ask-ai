"use client";

import type { RetrievedChunk } from "@selectdb/shared";

export function RetrievedChunks({ chunks }: { chunks: RetrievedChunk[] }) {
  return (
    <section className="panel chunks-panel">
      <h2>Retrieved chunks</h2>
      {chunks.length === 0 ? (
        <p className="muted">Enable debug and ask a question to inspect retrieval.</p>
      ) : (
        <div className="chunk-list">
          {chunks.map((chunk) => (
            <article key={chunk.chunkId} className="chunk-item">
              <div className="chunk-meta">
                <strong>{chunk.title ?? chunk.documentId}</strong>
                <span>{chunk.score.toFixed(4)}</span>
              </div>
              <p>{chunk.content}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
