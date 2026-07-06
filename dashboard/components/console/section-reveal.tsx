"use client";

import { motion } from "motion/react";
import { fadeUp } from "./motion";

export function SectionReveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-8% 0px -10% 0px" }}
      variants={fadeUp}
    >
      {children}
    </motion.div>
  );
}
