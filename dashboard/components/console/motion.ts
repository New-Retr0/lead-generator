/** Single motion token source for the coral operator console (Motion v12). */

export const EASE = [0.16, 1, 0.3, 1] as const;

export const duration = {
  instant: 0.12,
  fast: 0.2,
  normal: 0.35,
  slow: 0.5,
  progress: 1.4,
  particle: 1.2,
  shimmer: 1.5,
} as const;

export const easing = {
  out: EASE,
  linear: "linear" as const,
  inOut: [0.4, 0, 0.2, 1] as const,
} as const;

export const spring = {
  soft: { type: "spring" as const, stiffness: 260, damping: 24 },
  snappy: { type: "spring" as const, stiffness: 320, damping: 28 },
  layout: { type: "spring" as const, stiffness: 380, damping: 32 },
} as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.fast, ease: EASE },
  },
};

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12 },
  },
};

export const enter = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: duration.fast, ease: EASE },
  },
  slideUp: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: spring.soft,
  },
  slideLeft: {
    initial: { opacity: 0, x: -12 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -8 },
    transition: spring.soft,
  },
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
    transition: spring.snappy,
  },
} as const;

export const exit = {
  fade: { opacity: 0, transition: { duration: duration.fast } },
  slideUp: { opacity: 0, y: -8, transition: { duration: duration.fast } },
} as const;

/** Campaign Launch Control queue layout + connector motion. */
export const queueLayout = {
  card: spring.snappy,
  connectorPulse: {
    duration: duration.normal,
    ease: EASE,
  },
  gap: "gap-3",
} as const;

/** Indeterminate progress (doctor / live jobs). */
export const progress = {
  bar: {
    duration: duration.progress,
    ease: easing.linear,
    repeat: Infinity,
  },
  fillClass: "h-full w-1/3 bg-primary",
  trackClass: "h-0.5 w-full overflow-hidden bg-muted",
} as const;

/** Health-check reveal cadence — keep results from flashing in as one dump. */
export const doctorReveal = {
  /** Delay between revealing successive service rows (ms). */
  stepMs: 520,
  /** Soft enter for each settled check row. */
  row: {
    initial: { opacity: 0, y: 14, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -6, scale: 0.99 },
    transition: { type: "spring" as const, stiffness: 220, damping: 26, mass: 0.9 },
  },
  statusPop: {
    initial: { opacity: 0, scale: 0.7 },
    animate: { opacity: 1, scale: 1 },
    transition: { type: "spring" as const, stiffness: 380, damping: 22 },
  },
} as const;

/** Live-state motifs — prefer one at a time per surface. */
export const liveState = {
  pulseOnce: {
    scale: [1, 1.04, 1] as const,
    transition: { duration: 0.45, ease: EASE },
  },
  spinner: {
    rotate: 360,
    transition: { duration: 1.1, ease: easing.linear, repeat: Infinity },
  },
  particleMs: Math.round(duration.particle * 1000),
  maxParticlesGlobal: 24,
  maxParticlesPerEdge: 4,
} as const;
