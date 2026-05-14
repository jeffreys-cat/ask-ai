import { EmbeddedAskWidget } from "@/components/ask/EmbeddedAskWidget";

interface EmbedPageProps {
  searchParams: Promise<{
    projectId?: string;
    organizationId?: string;
    userId?: string;
    title?: string;
    placeholder?: string;
    brand?: string;
    primaryColor?: string;
  }>;
}

export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const params = await searchParams;

  return (
    <EmbeddedAskWidget
      projectId={params.projectId}
      organizationId={params.organizationId}
      userId={params.userId}
      title={params.title}
      placeholder={params.placeholder}
      brand={params.brand}
      primaryColor={params.primaryColor}
    />
  );
}
