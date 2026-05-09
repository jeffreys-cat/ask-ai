"use client";

import type { Citation } from "@selectdb/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SourcePreview } from "./SourcePreview";

export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Citations</CardTitle>
        <CardDescription>Source chunks used by the answer.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {citations.length === 0 ? <p className="text-sm text-muted-foreground">No citations yet.</p> : citations.map((citation) => <SourcePreview key={citation.id} citation={citation} />)}
      </CardContent>
    </Card>
  );
}
