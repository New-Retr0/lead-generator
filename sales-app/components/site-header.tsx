"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const titles: Record<string, string> = {
  "/": "Overview",
  "/requests": "Lead Requests",
  "/runs": "Runs",
  "/workspace": "Workspace",
  "/crm": "Workspace",
  "/leads": "Workspace",
  "/triage": "Workspace",
  "/duds": "Workspace",
  "/costs": "Costs",
};

export function SiteHeader() {
  const pathname = usePathname();
  const title = titles[pathname] ?? "PALLARES Leads";
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 shadow-sm md:px-8">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-4" />
      <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-2 rounded-full border border-success/25 bg-success/8 px-2.5 py-1 text-xs text-muted-foreground sm:flex">
          <span className="relative inline-flex size-1.5">
            <span
              className="absolute inline-flex size-full rounded-full bg-success"
              style={{ animation: "ping-soft 1.8s cubic-bezier(0,0,0.2,1) infinite" }}
            />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Lead engine
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
}
