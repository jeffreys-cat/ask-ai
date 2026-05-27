"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bot, ChevronUp, FileUp, FolderKanban, Home, KeyRound, LogOut, MessageSquareText, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/admin/projects" className="flex min-w-0 items-center gap-3 rounded-md px-1 py-1.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Bot />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">Ask AI</span>
            <span className="block truncate text-xs text-muted-foreground">litefuse</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {projectId ? <ProjectNavigation projectId={projectId} pathname={pathname} /> : <WorkspaceNavigation pathname={pathname} />}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}

function WorkspaceNavigation({ pathname }: { pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuButton href="/admin/projects" isActive={pathname.startsWith("/admin/projects")}>
          <FolderKanban />
          Projects
        </SidebarMenuButton>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ProjectNavigation({ projectId, pathname }: { projectId: string; pathname: string }) {
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
    <SidebarGroup className="gap-4">
      <SidebarMenu>
        <SidebarMenuButton href="/admin/projects">
          <ArrowLeft />
          Projects
        </SidebarMenuButton>
      </SidebarMenu>

      <div className="min-w-0 px-3">
        <p className="truncate text-sm font-semibold">{project?.name ?? "Project"}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{projectId}</p>
      </div>

      <SidebarMenu>
        <SidebarMenuButton href={`/admin/projects/${projectId}`} isActive={pathname === `/admin/projects/${projectId}`}>
          <Home />
          Overview
        </SidebarMenuButton>
        <SidebarMenuButton href={`/admin/projects/${projectId}/ingest`} isActive={pathname.startsWith(`/admin/projects/${projectId}/ingest`)}>
          <FileUp />
          Ingest
        </SidebarMenuButton>
        <SidebarMenuButton href={`/admin/projects/${projectId}/ask`} isActive={pathname === `/admin/projects/${projectId}/ask`}>
          <MessageSquareText />
          Ask
        </SidebarMenuButton>
        <SidebarMenuButton href={`/admin/projects/${projectId}/api-keys`} isActive={pathname === `/admin/projects/${projectId}/api-keys`}>
          <KeyRound />
          API keys
        </SidebarMenuButton>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function UserMenu({ user }: { user: AppSidebarUser }) {
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
          className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <UserAvatar initials={initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{displayEmail}</span>
          </span>
          <ChevronUp className="text-muted-foreground" />
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
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <Settings />
            Organization settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={signOut}>
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
