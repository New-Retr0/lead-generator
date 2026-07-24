"use client";

import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";

export function SettingsPageIntro() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6">
      <div className="absolute right-0 top-0 h-24 w-40 opacity-70 md:h-28 md:w-48">
        <ASCIIAnimation
          frameFolder="computer"
          frameCount={78}
          quality="medium"
          fps={12}
          className="h-full w-full [mask-image:linear-gradient(to_left,black_50%,transparent_100%)]"
          gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
          lazy
          ariaLabel="ASCII computer animation"
        />
      </div>
      <SectionHeading index="01" title="Settings" className="mb-3" />
      <h1 className="mb-2 max-w-xl text-xl font-medium tracking-tight text-foreground">
        Configure how the pipeline connects, spends, and runs
      </h1>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Two layers, one console: Connections and Run behavior write to{" "}
        <code className="text-foreground">.env</code>; YAML configs edit markets, categories, and
        pricing under <code className="text-foreground">config/</code>. Partner-ready means a
        verified named decision-maker — not a score threshold.
      </p>
      <ol className="grid max-w-3xl gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        <li className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <span className="font-mono text-[10px] text-primary">01</span>
          <p className="mt-1 font-medium text-foreground">Connections</p>
          <p className="text-xs leading-snug">API keys + Supabase — must be set before runs.</p>
        </li>
        <li className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <span className="font-mono text-[10px] text-primary">02</span>
          <p className="mt-1 font-medium text-foreground">Run behavior</p>
          <p className="text-xs leading-snug">
            Credit caps, scrape/proxy, Interact/agent escalation, reopen windows.
          </p>
        </li>
        <li className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <span className="font-mono text-[10px] text-primary">03</span>
          <p className="mt-1 font-medium text-foreground">YAML configs</p>
          <p className="text-xs leading-snug">
            Campaign matrix, markets (incl. radius), categories, roles, pricing.
          </p>
        </li>
      </ol>
    </div>
  );
}
