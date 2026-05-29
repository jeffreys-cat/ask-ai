import { AppSidebar, type AppSidebarUser } from "@/components/app/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({ children, user }: Readonly<{ children: React.ReactNode; user: AppSidebarUser }>) {
  return (
    <SidebarProvider className="bg-muted/25">
      <AppSidebar user={user} />
      <SidebarInset className="bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(255,255,255,1)_42%)]">{children}</SidebarInset>
    </SidebarProvider>
  );
}
