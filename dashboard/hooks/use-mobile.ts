import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

function subscribeMobile(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function mobileSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

/** Server + hydration snapshot is always desktop; client updates after mount. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false)
}
