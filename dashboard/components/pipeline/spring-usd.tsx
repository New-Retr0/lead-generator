"use client";

import { useEffect, useState } from "react";
import {
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { cn } from "@/lib/utils";

function formatUsdDigits(value: number, digits: number): string {
  const abs = Math.abs(value);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? "-" : ""}$${body}`;
}

/** Continuously springs toward `value` — never restarts a digit spin mid-flight. */
export function SpringUsd({
  value,
  digits = 2,
  className,
  stiffness = 100,
  damping = 24,
}: {
  value: number;
  digits?: number;
  className?: string;
  stiffness?: number;
  damping?: number;
}) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, {
    stiffness: reduced ? 1000 : stiffness,
    damping: reduced ? 50 : damping,
    mass: 0.7,
  });
  const [text, setText] = useState(() => formatUsdDigits(value, digits));

  useEffect(() => {
    spring.set(value);
    if (reduced) {
      // Jump immediately when motion is reduced — sync via motion value read.
      spring.jump(value);
    }
  }, [value, spring, reduced]);

  useMotionValueEvent(spring, "change", (latest) => {
    setText(formatUsdDigits(latest, digits));
  });

  return (
    <span className={cn("font-mono tabular-nums", className)}>{text}</span>
  );
}

export function SpringCount({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, {
    stiffness: reduced ? 1000 : 140,
    damping: reduced ? 50 : 26,
    mass: 0.65,
  });
  const [text, setText] = useState(() => String(Math.round(value)));

  useEffect(() => {
    spring.set(value);
    if (reduced) spring.jump(value);
  }, [value, spring, reduced]);

  useMotionValueEvent(spring, "change", (latest) => {
    setText(String(Math.round(latest)));
  });

  return (
    <span className={cn("font-mono tabular-nums", className)}>{text}</span>
  );
}

/** Stage dwell timer — springs through seconds with one decimal. */
export function SpringSeconds({
  valueMs,
  className,
}: {
  valueMs: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const seconds = Math.max(0, valueMs) / 1000;
  const spring = useSpring(seconds, {
    stiffness: reduced ? 1000 : 70,
    damping: reduced ? 50 : 18,
    mass: 0.8,
  });
  const [text, setText] = useState(() => `${seconds.toFixed(1)}s`);

  useEffect(() => {
    spring.set(seconds);
    if (reduced) spring.jump(seconds);
  }, [seconds, spring, reduced]);

  useMotionValueEvent(spring, "change", (latest) => {
    setText(`${Math.max(0, latest).toFixed(1)}s`);
  });

  return (
    <span className={cn("font-mono tabular-nums", className)}>{text}</span>
  );
}
