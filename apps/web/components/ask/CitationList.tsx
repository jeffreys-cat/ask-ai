"use client";

import type { Citation } from "@selectdb/shared";
import { SourcePreview } from "./SourcePreview";

export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <section className="citation-list">
      <h3>Citations</h3>
      {citations.length === 0 ? <p>No citations yet.</p> : citations.map((citation) => <SourcePreview key={citation.id} citation={citation} />)}
    </section>
  );
}
