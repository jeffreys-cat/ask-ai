import * as React from "react";
import Link, { type LinkProps } from "next/link";
import { cn } from "@/lib/utils";

export const SidebarProvider = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-screen w-full bg-background", className)} {...props} />
);

export const Sidebar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <aside
    ref={ref}
    className={cn("hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col", className)}
    {...props}
  />
));
Sidebar.displayName = "Sidebar";

export const SidebarHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border-b border-sidebar-border p-5", className)} {...props} />
);

export const SidebarContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3", className)} {...props} />
);

export const SidebarFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto border-t border-sidebar-border p-3", className)} {...props} />
);

export const SidebarGroup = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1", className)} {...props} />
);

export const SidebarGroupLabel = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("px-3 py-1 text-xs font-medium text-muted-foreground", className)} {...props} />
);

export const SidebarMenu = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <nav className={cn("grid gap-1", className)} {...props} />
);

type SidebarMenuButtonProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: LinkProps["href"];
  isActive?: boolean;
};

export const SidebarMenuButton = React.forwardRef<HTMLAnchorElement, SidebarMenuButtonProps>(
  ({ className, isActive, ...props }, ref) => (
    <Link
      ref={ref}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
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
