import { Badge } from "@/components/ui/badge";

export function ProjectStatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "ready" ? "default" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
