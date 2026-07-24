"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  BookOpen,
  Database,
  Droplets,
  LayoutDashboard,
  PlayCircle,
  Receipt,
  Rocket,
  Settings2,
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
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Command",
    items: [
      {
        href: "/",
        label: "Command Center",
        icon: LayoutDashboard,
        tooltip: "Overview",
      },
      {
        href: "/launch",
        label: "Launch",
        icon: Rocket,
        tooltip: "Launch runs",
      },
    ],
  },
  {
    label: "Observe",
    items: [
      {
        href: "/runs",
        label: "Runs",
        icon: PlayCircle,
        tooltip: "Run control",
      },
      {
        href: "/data",
        label: "Data",
        icon: Database,
        tooltip: "Lead inventory",
      },
      {
        href: "/costs",
        label: "Costs",
        icon: Receipt,
        tooltip: "Cost ledger",
      },
      {
        href: "/learn",
        label: "Playbooks",
        icon: BookOpen,
        tooltip: "Enrichment fast paths",
      },
    ],
  },
  {
    label: "Configure",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings2,
        tooltip: "Config",
      },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Droplets className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-mono text-xs font-bold tracking-[0.15em]">
                    PALLARES
                  </span>
                  <span className="truncate font-mono text-[10px] tracking-[0.12em] text-sidebar-foreground/60">
                    Dev Console
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
            <SidebarGroupLabel className="font-mono text-[9px] uppercase tracking-[0.18em]">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.tooltip}
                        className="relative font-mono text-[10px] uppercase tracking-[0.12em]"
                      >
                        <Link href={item.href} prefetch>
                          <item.icon />
                          <span>{item.label}</span>
                          {active ? (
                            <motion.span
                              layoutId="nav-indicator"
                              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                              transition={{ type: "spring", stiffness: 380, damping: 32 }}
                            />
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <p className="truncate px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
          Run · Observe · Learn
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
