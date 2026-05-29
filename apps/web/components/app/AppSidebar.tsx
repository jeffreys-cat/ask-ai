"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileUp,
  FolderKanban,
  Home,
  KeyRound,
  LogOut,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface AppSidebarUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

export function AppSidebar({ user }: { user: AppSidebarUser }) {
  const pathname = usePathname();
  const projectId = useProjectId(pathname);
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <Sidebar className={cn("border-sidebar-border/80 bg-sidebar/95 shadow-sm transition-[width] duration-200", isCollapsed && "w-16")}>
      <SidebarHeader className={cn("p-4", isCollapsed && "p-3")}>
        <div className={cn("flex items-center gap-2", isCollapsed ? "justify-center" : "justify-between")}>
          <Link
            href="/admin/projects"
            className={cn("flex min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-sidebar-accent/60", isCollapsed && "justify-center px-0")}
            aria-label="Projects"
            title={isCollapsed ? "Ask AI" : undefined}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <Bot />
            </span>
            <span className={cn("min-w-0", isCollapsed && "hidden")}>
              <span className="block truncate text-sm font-semibold">Ask AI</span>
              <span className="block truncate text-xs text-muted-foreground">litefuse</span>
            </span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(isCollapsed && "sr-only")}
            onClick={() => setIsCollapsed((current) => !current)}
            aria-label="Collapse app sidebar"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
        {isCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mx-auto mt-3"
            onClick={() => setIsCollapsed(false)}
            aria-label="Expand app sidebar"
            title="Expand app sidebar"
          >
            <ChevronRight className="size-4" />
          </Button>
        ) : null}
      </SidebarHeader>

      <SidebarContent className={cn(isCollapsed && "items-center px-2")}>
        {projectId ? (
          <ProjectNavigation projectId={projectId} pathname={pathname} isCollapsed={isCollapsed} />
        ) : (
          <WorkspaceNavigation pathname={pathname} isCollapsed={isCollapsed} />
        )}
      </SidebarContent>

      <SidebarFooter className={cn(isCollapsed && "p-2")}>
        <UserMenu user={user} isCollapsed={isCollapsed} />
      </SidebarFooter>
    </Sidebar>
  );
}

function WorkspaceNavigation({ pathname, isCollapsed }: { pathname: string; isCollapsed: boolean }) {
  return (
    <SidebarGroup className={cn(isCollapsed && "w-full items-center")}>
      {isCollapsed ? null : <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
      <SidebarMenu className={cn(isCollapsed && "w-full place-items-center")}>
        <SidebarMenuButton
          href="/admin/projects"
          isActive={pathname.startsWith("/admin/projects")}
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="Projects"
          title={isCollapsed ? "Projects" : undefined}
        >
          <FolderKanban />
          <span className={cn(isCollapsed && "hidden")}>Projects</span>
        </SidebarMenuButton>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ProjectNavigation({ projectId, pathname, isCollapsed }: { projectId: string; pathname: string; isCollapsed: boolean }) {
  const [project, setProject] = useState<{ name?: string | null } | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProject() {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { project: { name?: string | null } };
        if (isMounted) setProject(payload.project);
      } catch {
        if (isMounted) setProject(null);
      }
    }

    void loadProject();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  return (
    <SidebarGroup className={cn("gap-4", isCollapsed && "w-full items-center gap-3")}>
      <SidebarMenu className={cn(isCollapsed && "w-full place-items-center")}>
        <SidebarMenuButton
          href="/admin/projects"
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="Projects"
          title={isCollapsed ? "Projects" : undefined}
        >
          <ArrowLeft />
          <span className={cn(isCollapsed && "hidden")}>Projects</span>
        </SidebarMenuButton>
      </SidebarMenu>

      <div className={cn("min-w-0 px-3", isCollapsed && "hidden")}>
        <p className="truncate text-sm font-semibold">{project?.name ?? "Project"}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{projectId}</p>
      </div>

      <SidebarMenu className={cn(isCollapsed && "w-full place-items-center")}>
        <SidebarMenuButton
          href={`/admin/projects/${projectId}`}
          isActive={pathname === `/admin/projects/${projectId}`}
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="Overview"
          title={isCollapsed ? "Overview" : undefined}
        >
          <Home />
          <span className={cn(isCollapsed && "hidden")}>Overview</span>
        </SidebarMenuButton>
        <SidebarMenuButton
          href={`/admin/projects/${projectId}/ingest`}
          isActive={pathname.startsWith(`/admin/projects/${projectId}/ingest`)}
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="Ingest"
          title={isCollapsed ? "Ingest" : undefined}
        >
          <FileUp />
          <span className={cn(isCollapsed && "hidden")}>Ingest</span>
        </SidebarMenuButton>
        <SidebarMenuButton
          href={`/admin/projects/${projectId}/ask`}
          isActive={pathname === `/admin/projects/${projectId}/ask`}
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="Ask"
          title={isCollapsed ? "Ask" : undefined}
        >
          <MessageSquareText />
          <span className={cn(isCollapsed && "hidden")}>Ask</span>
        </SidebarMenuButton>
        <SidebarMenuButton
          href={`/admin/projects/${projectId}/api-keys`}
          isActive={pathname === `/admin/projects/${projectId}/api-keys`}
          className={collapsedMenuButtonClass(isCollapsed)}
          aria-label="API keys"
          title={isCollapsed ? "API keys" : undefined}
        >
          <KeyRound />
          <span className={cn(isCollapsed && "hidden")}>API keys</span>
        </SidebarMenuButton>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function UserMenu({ user, isCollapsed }: { user: AppSidebarUser; isCollapsed: boolean }) {
  const router = useRouter();
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "User";
  const displayEmail = user.email || user.id;
  const initials = initialsFor(displayName);

  function signOut() {
    void authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in");
          router.refresh();
        },
      },
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            isCollapsed && "justify-center px-0",
          )}
          aria-label="User menu"
          title={isCollapsed ? displayName : undefined}
        >
          <UserAvatar initials={initials} />
          <span className={cn("min-w-0 flex-1", isCollapsed && "hidden")}>
            <span className="block truncate font-medium">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{displayEmail}</span>
          </span>
          <ChevronUp className={cn("text-muted-foreground", isCollapsed && "hidden")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="flex min-w-0 items-center gap-3">
          <UserAvatar initials={initials} />
          <span className="min-w-0">
            <span className="block truncate">{displayName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{displayEmail}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function collapsedMenuButtonClass(isCollapsed: boolean) {
  return cn(isCollapsed && "size-9 justify-center px-0 py-0");
}

function UserAvatar({ initials }: { initials: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground",
      )}
    >
      {initials}
    </span>
  );
}

function initialsFor(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function useProjectId(pathname: string) {
  return useMemo(() => {
    const match = pathname.match(/^\/admin\/projects\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
}
