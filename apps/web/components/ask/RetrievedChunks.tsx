"use client";

import type { RetrievedChunk } from "@selectdb/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RetrievedChunks({ chunks }: { chunks: RetrievedChunk[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrieved chunks</CardTitle>
        <CardDescription>Debug view for retrieval results.</CardDescription>
      </CardHeader>
      <CardContent>
        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Enable debug and ask a question to inspect retrieval.</p>
        ) : (
          <div className="grid gap-3">
          {chunks.map((chunk) => (
            <article key={chunk.chunkId} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <strong>{chunk.title ?? chunk.documentId}</strong>
                <span className="text-xs text-muted-foreground">{chunk.score.toFixed(4)}</span>
              </div>
              {chunk.sourceUri ? <p className="mt-2 break-all text-xs text-muted-foreground">{chunk.sourceUri}</p> : null}
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{chunk.content}</p>
            </article>
          ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
