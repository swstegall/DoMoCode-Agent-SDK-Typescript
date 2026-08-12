/**
 * Deterministic response-stream faults for protocol and reconnect tests.
 *
 * It deliberately wraps the platform fetch seam rather than depending on a
 * server, proxy, or test-only HTTP library. A one-byte chunk size exercises
 * UTF-8 and SSE delimiter boundaries that normal fetch implementations often
 * hide behind much larger network buffers.
 */
export class FaultInjector {
    chunkSize;
    delayMs;
    truncateAfterBytes;
    counters = { requests: 0, responses: 0, bytes: 0, truncated: 0 };
    constructor(options = {}) {
        if (options.chunkSize !== undefined && (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1))
            throw new TypeError("FaultInjector chunkSize must be a positive integer");
        if (options.delayMs !== undefined && (!Number.isFinite(options.delayMs) || options.delayMs < 0))
            throw new TypeError("FaultInjector delayMs must be a finite non-negative number");
        if (options.truncateAfterBytes !== undefined && (!Number.isSafeInteger(options.truncateAfterBytes) || options.truncateAfterBytes < 1))
            throw new TypeError("FaultInjector truncateAfterBytes must be a positive integer");
        this.chunkSize = options.chunkSize;
        this.delayMs = options.delayMs ?? 0;
        this.truncateAfterBytes = options.truncateAfterBytes;
    }
    get stats() { return { ...this.counters }; }
    reset() { this.counters = { requests: 0, responses: 0, bytes: 0, truncated: 0 }; }
    fetch(baseFetch) {
        return async (input, init) => {
            this.counters.requests += 1;
            const response = await baseFetch(input, init);
            this.counters.responses += 1;
            if (!response.body || (this.chunkSize === undefined && this.truncateAfterBytes === undefined && this.delayMs === 0))
                return response;
            const reader = response.body.getReader();
            const body = new ReadableStream({
                start: async (controller) => {
                    let emitted = 0;
                    try {
                        while (true) {
                            const item = await reader.read();
                            if (item.done)
                                break;
                            if (!item.value || item.value.byteLength === 0)
                                continue;
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
                                if (this.delayMs > 0)
                                    await wait(this.delayMs);
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
                    }
                    catch (error) {
                        try {
                            controller.error(error);
                        }
                        catch { /* consumer already cancelled */ }
                    }
                    finally {
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
function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
//# sourceMappingURL=fault-injector.js.map