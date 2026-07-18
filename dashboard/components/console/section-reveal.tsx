"use client";

import { motion, useReducedMotion } from "motion/react";
import { fadeUp } from "./motion";

export function SectionReveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return <div>{children}</div>;
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.08 }}
      variants={fadeUp}
    >
      {children}
    </motion.div>
  );
}
