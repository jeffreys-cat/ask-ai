import { AppSidebar, type AppSidebarUser } from "@/components/app/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({ children, user }: Readonly<{ children: React.ReactNode; user: AppSidebarUser }>) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
