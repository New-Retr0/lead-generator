"use client";

import { motion } from "motion/react";
import { useHydrated, useSafeReducedMotion } from "@/hooks/use-hydrated";
import { fadeUp } from "./motion";

export function SectionReveal({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const reduced = useSafeReducedMotion();
  // Keep a stable wrapper element so hydration → motion does not remount children
  // (that swap read as a flash on first paint).
  const motionReady = hydrated && !reduced;
  return (
    <motion.div
      initial={motionReady ? "hidden" : false}
      whileInView={motionReady ? "visible" : undefined}
      viewport={motionReady ? { once: true, amount: 0.08 } : undefined}
      variants={motionReady ? fadeUp : undefined}
    >
      {children}
    </motion.div>
  );
}
