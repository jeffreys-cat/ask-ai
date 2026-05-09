import * as React from "react";
import { cn } from "@/lib/utils";

export const SidebarProvider = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-screen w-full bg-background", className)} {...props} />
);

export const Sidebar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <aside
    ref={ref}
    className={cn("hidden w-64 shrink-0 border-r bg-card text-card-foreground md:block", className)}
    {...props}
  />
));
Sidebar.displayName = "Sidebar";

export const SidebarHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border-b p-5", className)} {...props} />
);

export const SidebarContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-3", className)} {...props} />
);

export const SidebarMenu = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <nav className={cn("grid gap-1", className)} {...props} />
);

export const SidebarMenuButton = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { isActive?: boolean }>(
  ({ className, isActive, ...props }, ref) => (
    <a
      ref={ref}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export const SidebarInset = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <main ref={ref} className={cn("min-w-0 flex-1", className)} {...props} />
));
SidebarInset.displayName = "SidebarInset";
