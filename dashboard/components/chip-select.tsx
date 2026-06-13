"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipOption = {
  value: string;
  label: string;
  hint?: string;
};

/** Multi-select rendered as toggleable chips. */
export function ChipSelect({
  options,
  selected,
  onChange,
  className,
}: {
  options: ChipOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <motion.button
            key={option.value}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => toggle(option.value)}
            aria-pressed={active}
            title={option.hint}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            {active && <Check className="size-3" />}
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}
