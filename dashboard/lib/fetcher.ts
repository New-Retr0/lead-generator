/** Typed fetch wrapper — every dashboard request times out and surfaces errors. */

import { apiFetch } from "./api-client";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * JSON fetch with a hard timeout (15s default) and a typed error.
 * Uses apiFetch so Authorization is attached when a dashboard token is set.
 */
export async function fetchJson<T>(
  input: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init ?? {};

  let res: Response;
  try {
    res = await apiFetch(input, {
      ...rest,
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 408);
    }
    throw new ApiError(err instanceof Error ? err.message : "Network error", 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through — treated as an error below when status is bad
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? String((body as { error: string }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  if (body === null) {
    throw new ApiError("Malformed JSON response", res.status);
  }
  return body as T;
}
