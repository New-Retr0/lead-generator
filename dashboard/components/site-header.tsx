"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ActiveOpsChip } from "@/components/active-ops-chip";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const titles: Record<string, string> = {
  "/": "Command Center",
  "/launch": "Launch",
  "/learn": "Playbooks",
  "/campaigns": "Launch",
  "/runs": "Runs",
  "/requests": "Launch",
  "/data": "Lead Data",
  "/costs": "Costs & Credits",
  "/settings": "Settings",
};

function titleForPath(pathname: string): string {
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/runs/")) return "Live Run";
  return "PALLARES Leads";
}

export function SiteHeader() {
  const pathname = usePathname();
  const title = titleForPath(pathname);
  const { theme, setTheme } = useTheme();

  return (
    <header className="panel-strong sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-none border-b border-border/50 px-4 md:px-8">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-4" />
      <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em]">
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-2">
        <ActiveOpsChip />
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
