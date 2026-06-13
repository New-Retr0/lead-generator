const ALLOWED = new Set(["http:", "https:", "tel:", "mailto:"]);

export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED.has(parsed.protocol)) return null;
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "127.0.0.1" ||
        host === "::1"
      ) {
        return null;
      }
    }
    return trimmed;
  } catch {
    return null;
  }
}
