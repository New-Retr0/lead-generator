"use client";

import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type FormatProp = Intl.NumberFormatOptions | ((n: number) => string);

const FORMAT_PROBE_VALUES = [0, 1, 42, 1234.56, 0.0009] as const;

const INTL_FORMAT_CANDIDATES: Intl.NumberFormatOptions[] = [
  { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 },
  { style: "currency", currency: "USD", maximumFractionDigits: 2 },
  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  { maximumFractionDigits: 0 },
];

function matchesIntlOptions(
  fn: (n: number) => string,
  options: Intl.NumberFormatOptions,
): boolean {
  const intl = new Intl.NumberFormat("en-US", options);
  return FORMAT_PROBE_VALUES.every((n) => fn(n) === intl.format(n));
}

function inferFunctionFormat(fn: (n: number) => string): Intl.NumberFormatOptions {
  for (const options of INTL_FORMAT_CANDIDATES) {
    if (matchesIntlOptions(fn, options)) return options;
  }

  const samples = FORMAT_PROBE_VALUES.map(fn);
  const currencySamples = samples.filter((sample) => sample.includes("$"));
  if (currencySamples.length > 0) {
    const microSample = fn(0.0009);
    const maxDecimals = microSample.includes(".")
      ? (microSample.split(".")[1]?.replace(/[^0-9]/g, "").length ?? 2)
      : 2;
    return {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDecimals,
    };
  }

  if (samples.some((sample) => sample.includes("."))) {
    return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  }
  return { maximumFractionDigits: 0 };
}

function toIntlFormat(format?: FormatProp): Intl.NumberFormatOptions {
  if (!format) return { maximumFractionDigits: 0 };
  if (typeof format !== "function") return format;
  return inferFunctionFormat(format);
}

function climbTiming(seconds: number): EffectTiming {
  return { duration: Math.round(seconds * 1000), easing: "ease-out" };
}

export function AnimateNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: FormatProp;
  className?: string;
}) {
  const timing = climbTiming(0.7);
  return (
    <NumberFlow
      value={value}
      format={toIntlFormat(format) as Intl.NumberFormatOptions & { notation?: "standard" | "compact" }}
      transformTiming={timing}
      spinTiming={timing}
      className={cn("font-mono tabular-nums", className)}
      willChange
    />
  );
}

export const AnimatedNumber = AnimateNumber;

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 260, damping: 26 },
  },
};

export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

/** Pulsing status dot with an expanding ping halo. */
export function LiveDot({
  tone = "success",
  className,
}: {
  tone?: "success" | "warning" | "danger" | "primary";
  className?: string;
}) {
  const color =
    tone === "success"
      ? "bg-success"
      : tone === "warning"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-destructive"
          : "bg-primary";
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      <span
        className={cn(
          "absolute inline-flex size-full rounded-full",
          color,
        )}
        style={{ animation: "ping-soft 1.6s cubic-bezier(0, 0, 0.2, 1) infinite" }}
      />
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

/** One-shot entrance used for list rows appearing live (e.g. streamed events). */
export function SlideIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Odometer-style rolling counter — NumberFlow digit spin with optional currency formatting.
 */
export function Odometer({
  value,
  format,
  className,
  climbSeconds = 1.8,
}: {
  value: number;
  format?: FormatProp;
  className?: string;
  climbSeconds?: number;
}) {
  const timing = climbTiming(climbSeconds);
  return (
    <NumberFlow
      value={value}
      format={toIntlFormat(format) as Intl.NumberFormatOptions & { notation?: "standard" | "compact" }}
      transformTiming={timing}
      spinTiming={timing}
      className={cn("inline-flex font-mono tabular-nums", className)}
      willChange
    />
  );
}

/** Chat-style typing indicator — three bouncing dots. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-current"
          animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
