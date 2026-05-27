import { ProjectDetail } from "@/components/projects/ProjectDetail";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectApiKeysPage({ params }: PageProps) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} view="api-keys" />;
}
