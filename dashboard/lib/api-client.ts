/** Browser helper for authenticated dashboard API calls. */

function clientToken(): string {
  return (process.env.NEXT_PUBLIC_DASHBOARD_API_TOKEN ?? "").trim();
}

export function withApiToken(path: string): string {
  const token = clientToken();
  if (!token) return path;
  const url = new URL(path, typeof window !== "undefined" ? window.location.origin : "http://local");
  if (!url.searchParams.has("token")) {
    url.searchParams.set("token", token);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = clientToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

export function apiStreamUrl(path: string): string {
  return withApiToken(path);
}
