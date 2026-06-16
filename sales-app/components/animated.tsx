"use client";

import { useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils";

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, (v) =>
    format ? format(v) : Math.round(v).toLocaleString(),
  );

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, motionValue]);

  return <motion.span className={className}>{text}</motion.span>;
}

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

const ODOMETER_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DIGIT_EM = 1.2;

function OdometerChar({ char }: { char: string }) {
  if (!/^\d$/.test(char)) {
    return (
      <span
        className="inline-block"
        style={{ height: `${DIGIT_EM}em`, lineHeight: `${DIGIT_EM}em` }}
      >
        {char}
      </span>
    );
  }
  const n = Number(char);
  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ width: "1ch", height: `${DIGIT_EM}em` }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        animate={{ y: `${-n * DIGIT_EM}em` }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        {ODOMETER_DIGITS.map((d) => (
          <span
            key={d}
            className="flex items-center justify-center"
            style={{ height: `${DIGIT_EM}em`, lineHeight: `${DIGIT_EM}em` }}
          >
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * Odometer-style rolling counter. Climbs smoothly from its current displayed
 * value to the target, rolling each digit like a meter — queued increases keep
 * the number visibly ticking up.
 */
export function Odometer({
  value,
  format,
  className,
  climbSeconds = 1.8,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  climbSeconds?: number;
}) {
  const motionValue = useMotionValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: climbSeconds,
      ease: [0.22, 0.9, 0.32, 1],
    });
    return () => controls.stop();
  }, [value, motionValue, climbSeconds]);

  useMotionValueEvent(motionValue, "change", (v) => setDisplay(v));

  const finalText = format ? format(value) : Math.round(value).toLocaleString();
  const text = format ? format(display) : Math.round(display).toLocaleString();
  const chars = text.split("");

  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{finalText}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((ch, i) => (
          <OdometerChar key={chars.length - i} char={ch} />
        ))}
      </span>
    </span>
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
