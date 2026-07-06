"use client";

import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { TypedText } from "@/components/console/typed-text";

export function SettingsPageIntro() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6">
      <div className="absolute right-0 top-0 h-24 w-40 md:h-28 md:w-48">
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
      <TypedText text="ENV + YAML — pipeline configuration" className="mb-2 block" />
      <p className="max-w-xl text-sm text-muted-foreground">
        Pipeline environment variables (.env) and YAML configuration files.
      </p>
    </div>
  );
}
