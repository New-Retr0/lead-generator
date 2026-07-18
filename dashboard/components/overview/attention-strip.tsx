import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  PhoneCall,
  PlayCircle,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type AttentionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "default" | "warning" | "danger" | "success" | "secondary";
  hint: string;
};

export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  const actionable = items.filter((item) => item.count > 0);

  return (
    <Card className="hover-lift border-primary/20" data-testid="attention-strip">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]">
            <AlertTriangle className="size-4 text-warning" />
            Attention
          </CardTitle>
          <CardDescription className="mt-1">
            Highest-leverage queues for callable, verified decision-makers.
          </CardDescription>
        </div>
        {actionable.length === 0 ? (
          <Badge variant="success">Clear</Badge>
        ) : (
          <Badge variant="warning">{actionable.length} open</Badge>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon =
            item.key === "running"
              ? PlayCircle
              : item.key === "ready"
                ? PhoneCall
                : item.key === "inventory"
                  ? ShieldAlert
                  : AlertTriangle;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="panel group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:border-primary/35 hover:bg-accent"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/80">
                <Icon className="size-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    {item.label}
                  </p>
                  <Badge variant={item.tone} className="tabular-nums">
                    {item.count}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-snug text-foreground/80">{item.hint}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Open
                  <ArrowRight className="size-3" />
                </span>
              </div>
            </Link>
          );
        })}
      </CardContent>
      {actionable.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-6 pb-5">
          {actionable.slice(0, 2).map((item) => (
            <Button key={item.key} asChild size="sm" variant="outline">
              <Link href={item.href}>
                {item.label}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
