"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

class AnimationManager {
  private _animation: number | null = null;
  private callback: () => void;
  private lastFrame = -1;
  private frameTime = 1000 / 30;

  constructor(callback: () => void, fps = 30) {
    this.callback = callback;
    this.frameTime = 1000 / fps;
  }

  start() {
    if (this._animation != null) return;
    this._animation = requestAnimationFrame(this.update);
  }

  pause() {
    if (this._animation == null) return;
    this.lastFrame = -1;
    cancelAnimationFrame(this._animation);
    this._animation = null;
  }

  private update = (time: number) => {
    const { lastFrame } = this;
    let delta = time - lastFrame;
    if (this.lastFrame === -1) {
      this.lastFrame = time;
    } else {
      while (delta >= this.frameTime) {
        this.callback();
        delta -= this.frameTime;
        this.lastFrame += this.frameTime;
      }
    }
    this._animation = requestAnimationFrame(this.update);
  };
}

type Quality = "low" | "medium" | "high";

const FALLBACK_ORDER: Record<Quality, Quality[]> = {
  low: ["low", "medium", "high"],
  medium: ["medium", "high", "low"],
  high: ["high", "medium", "low"],
};

function normalizeFrameFolder(frameFolder: string): string {
  return frameFolder.replace(/^\/+/, "").replace(/^animations\//, "");
}

async function resolveFrameSource(
  frameFolder: string,
  quality: Quality,
  firstFrameFile: string,
): Promise<{ baseUrl: string } | null> {
  const folder = normalizeFrameFolder(frameFolder);
  for (const candidate of FALLBACK_ORDER[quality]) {
    try {
      const probeUrl = `/animations/${folder}/${candidate}/${firstFrameFile}`;
      const probeResponse = await fetch(probeUrl);
      if (probeResponse.ok) {
        return { baseUrl: `/animations/${folder}/${candidate}` };
      }
    } catch {
      // continue
    }
  }
  return null;
}

interface ASCIIAnimationProps {
  frames?: string[];
  className?: string;
  fps?: number;
  frameCount?: number;
  frameFolder?: string;
  textSize?: string;
  showFrameCounter?: boolean;
  quality?: Quality;
  ariaLabel?: string;
  lazy?: boolean;
  color?: string;
  gradient?: string;
}

export default function ASCIIAnimation({
  frames: providedFrames,
  className = "",
  fps = 24,
  frameCount = 60,
  frameFolder = "frames",
  textSize = "text-xs",
  showFrameCounter = false,
  ariaLabel,
  quality = "medium",
  lazy = true,
  color = "color-mix(in oklab, var(--foreground) 80%, var(--primary) 20%)",
  gradient,
}: ASCIIAnimationProps) {
  const [frames, setFrames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const frameCounterRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaled, setScaled] = useState(false);
  const currentFrameRef = useRef(0);
  const framesRef = useRef<string[]>([]);
  const animationManagerRef = useRef<AnimationManager | null>(null);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  const frameFiles = useMemo(
    () =>
      Array.from({ length: frameCount }, (_, i) => `frame_${String(i + 1).padStart(5, "0")}.txt`),
    [frameCount],
  );

  const fullLoadTriggered = useRef(false);
  const resolvedSource = useRef<{ baseUrl: string } | null>(null);

  const loadAllFrames = useCallback(async () => {
    if (fullLoadTriggered.current) return;
    fullLoadTriggered.current = true;
    let source = resolvedSource.current;
    if (!source) {
      source = await resolveFrameSource(frameFolder, quality, frameFiles[0]);
      resolvedSource.current = source;
    }
    if (!source) {
      fullLoadTriggered.current = false;
      setIsLoading(false);
      return;
    }
    try {
      const loadedFrames = await Promise.all(
        frameFiles.map(async (filename) => {
          const response = await fetch(`${source.baseUrl}/${filename}`);
          if (!response.ok) throw new Error(`Failed to fetch ${filename}`);
          return response.text();
        }),
      );
      setFrames(loadedFrames);
      currentFrameRef.current = 0;
    } catch (error) {
      console.error("Failed to load ASCII frames:", error);
      fullLoadTriggered.current = false;
    } finally {
      setIsLoading(false);
    }
  }, [frameFiles, frameFolder, quality]);

  useEffect(() => {
    fullLoadTriggered.current = false;
    resolvedSource.current = null;

    const loadPreview = async () => {
      if (providedFrames) {
        setFrames(providedFrames);
        setIsLoading(false);
        fullLoadTriggered.current = true;
        return;
      }

      const source = await resolveFrameSource(frameFolder, quality, frameFiles[0]);
      if (!source) {
        setIsLoading(false);
        return;
      }
      resolvedSource.current = source;

      try {
        const response = await fetch(`${source.baseUrl}/${frameFiles[0]}`);
        const firstFrame = await response.text();
        setFrames([firstFrame]);
        currentFrameRef.current = 0;
      } catch {
        // preview failed
      }

      if (!lazy) await loadAllFrames();
      else setIsLoading(false);
    };

    void loadPreview();
  }, [providedFrames, frameFolder, quality, lazy, frameFiles, loadAllFrames]);

  useEffect(() => {
    animationManagerRef.current = new AnimationManager(() => {
      const f = framesRef.current;
      if (f.length === 0) return;
      const nextFrame = (currentFrameRef.current + 1) % f.length;
      currentFrameRef.current = nextFrame;
      if (preRef.current) preRef.current.textContent = f[nextFrame];
      if (frameCounterRef.current) {
        frameCounterRef.current.textContent = `Frame: ${nextFrame + 1}/${f.length}`;
      }
    }, fps);

    return () => {
      animationManagerRef.current?.pause();
    };
  }, [fps]);

  useEffect(() => {
    if (frames.length === 0 || !containerRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const manager = animationManagerRef.current;
    if (!manager) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (lazy && !fullLoadTriggered.current) void loadAllFrames();
          if (!reducedMotion) manager.start();
        } else {
          manager.pause();
        }
      });
    }, { threshold: 0.1 });

    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      manager.pause();
    };
  }, [frames.length, lazy, loadAllFrames]);

  useLayoutEffect(() => {
    if (!containerRef.current || !preRef.current || frames.length === 0) return;
    const updateScale = () => {
      const container = containerRef.current;
      const content = preRef.current;
      if (!container || !content) return;
      const newScale = Math.min(
        container.clientWidth / content.scrollWidth,
        container.clientHeight / content.scrollHeight,
      );
      if (content.scrollWidth > 0 && content.scrollHeight > 0) {
        setScale(newScale * 0.95);
        setScaled(true);
      }
    };
    updateScale();
    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [frames]);

  if (isLoading && frames.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center ${className}`}>
        <div className="size-6 animate-spin rounded-full border border-border border-t-primary" />
      </div>
    );
  }

  if (!frames.length) {
    return <div className={`font-mono ${className}`}>No frames loaded</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})}
    >
      {showFrameCounter ? (
        <div
          ref={frameCounterRef}
          className="absolute left-2 top-2 z-10 rounded bg-card/50 px-2 py-1 font-mono text-xs"
        >
          Frame: 1/{frames.length}
        </div>
      ) : null}
      <pre
        ref={preRef}
        className={`origin-center leading-none ${textSize}`}
        style={{
          transform: `scale(${scale})`,
          opacity: scaled || frames.length > 0 ? 1 : 0,
          transition: "opacity 0.5s ease-in",
          ...(gradient
            ? {
                background: gradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }
            : color
              ? { color }
              : {}),
        }}
      >
        {frames[0]}
      </pre>
    </div>
  );
}
