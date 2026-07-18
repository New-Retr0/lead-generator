"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Lightweight route enter fade (CSS only).
 * Avoids pulling Motion onto every navigation critical path.
 */
export default function Template({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-in fade-in-0 duration-150">
      {children}
    </div>
  );
}
