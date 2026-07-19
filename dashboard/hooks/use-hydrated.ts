"use client";

import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";

function subscribeNoop(): () => void {
  return () => {};
}

/**
 * False during SSR and the hydration pass (matches server HTML), then true.
 * Use before reading localStorage / matchMedia / other client-only sources.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/**
 * prefers-reduced-motion, stable through SSR/hydration (always false until hydrated).
 * Prevents tree swaps when matchMedia resolves after the first paint.
 */
export function useSafeReducedMotion(): boolean {
  const hydrated = useHydrated();
  const reduced = useReducedMotion();
  return hydrated ? Boolean(reduced) : false;
}
