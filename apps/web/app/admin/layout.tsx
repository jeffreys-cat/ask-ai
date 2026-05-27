import { AppShell } from "@/components/app/AppShell";
import { requirePageSession } from "@/lib/page-auth";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requirePageSession("/admin/projects");

  return <AppShell user={session.user}>{children}</AppShell>;
}
