import type { FetchFunction } from "../transport.ts";

export interface FaultInjectorOptions {
  /** Split every response body into chunks no larger than this many bytes. */
  chunkSize?: number;
  /** Delay each injected chunk by this many milliseconds. */
  delayMs?: number;
  /** Close a response after this many body bytes, simulating a dropped stream. */
  truncateAfterBytes?: number;
}

export interface FaultInjectorStats {
  requests: number;
  responses: number;
  bytes: number;
  truncated: number;
}

/**
 * Deterministic response-stream faults for protocol and reconnect tests.
 *
 * It deliberately wraps the platform fetch seam rather than depending on a
 * server, proxy, or test-only HTTP library. A one-byte chunk size exercises
 * UTF-8 and SSE delimiter boundaries that normal fetch implementations often
 * hide behind much larger network buffers.
 */
export class FaultInjector {
  private readonly chunkSize: number | undefined;
  private readonly delayMs: number;
  private readonly truncateAfterBytes: number | undefined;
  private counters: FaultInjectorStats = { requests: 0, responses: 0, bytes: 0, truncated: 0 };

  constructor(options: FaultInjectorOptions = {}) {
    if (options.chunkSize !== undefined && (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1)) throw new TypeError("FaultInjector chunkSize must be a positive integer");
    if (options.delayMs !== undefined && (!Number.isFinite(options.delayMs) || options.delayMs < 0)) throw new TypeError("FaultInjector delayMs must be a finite non-negative number");
    if (options.truncateAfterBytes !== undefined && (!Number.isSafeInteger(options.truncateAfterBytes) || options.truncateAfterBytes < 1)) throw new TypeError("FaultInjector truncateAfterBytes must be a positive integer");
    this.chunkSize = options.chunkSize;
    this.delayMs = options.delayMs ?? 0;
    this.truncateAfterBytes = options.truncateAfterBytes;
  }

  get stats(): FaultInjectorStats { return { ...this.counters }; }

  reset(): void { this.counters = { requests: 0, responses: 0, bytes: 0, truncated: 0 }; }

  fetch(baseFetch: FetchFunction): FetchFunction {
    return async (input, init) => {
      this.counters.requests += 1;
      const response = await baseFetch(input, init);
      this.counters.responses += 1;
      if (!response.body || (this.chunkSize === undefined && this.truncateAfterBytes === undefined && this.delayMs === 0)) return response;

      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          let emitted = 0;
          try {
            while (true) {
              const item = await reader.read();
              if (item.done) break;
              if (!item.value || item.value.byteLength === 0) continue;
              let offset = 0;
              while (offset < item.value.byteLength) {
                const remaining = item.value.byteLength - offset;
                const limit = this.truncateAfterBytes === undefined ? remaining : this.truncateAfterBytes - emitted;
                if (limit <= 0) {
                  this.counters.truncated += 1;
                  controller.close();
                  await reader.cancel();
                  return;
                }
                const size = Math.min(remaining, limit, this.chunkSize ?? remaining);
                const chunk = item.value.slice(offset, offset + size);
                offset += size;
                emitted += size;
                this.counters.bytes += size;
                if (this.delayMs > 0) await wait(this.delayMs);
                controller.enqueue(chunk);
                if (this.truncateAfterBytes !== undefined && emitted >= this.truncateAfterBytes) {
                  this.counters.truncated += 1;
                  controller.close();
                  await reader.cancel();
                  return;
                }
              }
            }
            controller.close();
          } catch (error) {
            try { controller.error(error); } catch { /* consumer already cancelled */ }
          } finally {
            reader.releaseLock();
          }
        },
        cancel: (reason) => reader.cancel(reason)
      });
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    };
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
