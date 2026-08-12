import type { FetchFunction } from "../transport.ts";

export interface CapturedRequest { method: string; url: string; headers: Record<string, string>; body?: unknown }
export interface CapturedResponse { status: number; headers: Record<string, string>; body?: unknown }
export interface CaptureRecord { request: CapturedRequest; response?: CapturedResponse; events: unknown[] }

export class CaptureHarness {
  readonly records: CaptureRecord[] = [];

  fetch(baseFetch: FetchFunction): FetchFunction {
    return async (input, init) => {
      const request = await captureRequest(input, init);
      const record: CaptureRecord = { request, events: [] };
      this.records.push(record);
      const response = await baseFetch(input, init);
      record.response = { status: response.status, headers: Object.fromEntries(response.headers.entries()) };
      if (!response.body || request.url.includes("/events")) return response;
      const body = await response.clone().text();
      if (body) {
        try { record.response.body = JSON.parse(body) as unknown; } catch { record.response.body = body; }
      }
      return response;
    };
  }

  recordEvent(event: unknown): void {
    const last = this.records.at(-1);
    if (last) last.events.push(scrubSecrets(event));
  }

  toJSON(): CaptureRecord[] { return this.records.map((record) => scrubSecrets(record) as CaptureRecord); }
}

export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const sensitive = key.toLowerCase() === "authorization" || /token|api.?key/i.test(key);
    result[key] = sensitive ? "[REDACTED]" : scrubSecrets(item);
  }
  return result;
}

async function captureRequest(input: RequestInfo | URL, init?: RequestInit): Promise<CapturedRequest> {
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const request: CapturedRequest = { method: init?.method ?? "GET", url: input instanceof Request ? input.url : input.toString(), headers: scrubSecrets(headers) as Record<string, string> };
  if (typeof init?.body === "string") {
    try { request.body = scrubSecrets(JSON.parse(init.body)); } catch { request.body = "[non-json body]"; }
  }
  return request;
}
