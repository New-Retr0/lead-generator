"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ContactRound,
  Droplets,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  ScrollText,
  PlayCircle,
  Receipt,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SignOutButton } from "@/components/sign-out-button";

const groups = [
  {
    label: "Command",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: ListChecks },
      { href: "/requests", label: "Lead Requests", icon: MessageSquareText },
      { href: "/runs", label: "Runs", icon: PlayCircle },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/costs", label: "Costs", icon: Receipt },
      { href: "/partner-api", label: "Partner API", icon: ScrollText },
    ],
  },
  {
    label: "Deprecated",
    items: [{ href: "/workspace", label: "Deprecated CRM", icon: ContactRound }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={closeMobileNav}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-primary to-[oklch(0.55_0.16_300)] text-sidebar-primary-foreground shadow-[0_4px_16px_-4px_oklch(0.58_0.18_262/0.7)]">
                  <Droplets className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-bold tracking-wide">
                    PALLARES
                  </span>
                  <span className="truncate text-xs text-sidebar-foreground/60">
                    Developer Console
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <Link href={item.href} onClick={closeMobileNav}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SignOutButton />
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="truncate px-2 pb-1 text-[10px] uppercase tracking-widest text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
          Private command console
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
