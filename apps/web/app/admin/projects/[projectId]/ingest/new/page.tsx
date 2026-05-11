import { ProjectDetail } from "@/components/projects/ProjectDetail";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectIngestNewPage({ params }: PageProps) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} view="ingest-new" />;
}
