import { requirePageSession } from "@/lib/page-auth";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requirePageSession("/admin/projects");
  return children;
}
