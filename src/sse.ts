export class SseDecodeError extends Error {
  constructor(message: string, public readonly frame?: string) { super(message); this.name = "SseDecodeError"; }
}

export async function* readSSEFrames(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new SseDecodeError("SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const abort = () => { void reader.cancel(); };
  if (signal) {
    if (signal.aborted) await reader.cancel();
    else signal.addEventListener("abort", abort, { once: true });
  }
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) buffer = concatBytes(buffer, result.value);
      while (true) {
        const delimiter = findDelimiter(buffer);
        if (!delimiter) break;
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter.length);
        const decoded = decoder.decode(frame);
        const data = parseSSEData(decoded);
        if (data !== undefined) yield data;
      }
    }
    if (buffer.length > 0) {
      const data = parseSSEData(decoder.decode(buffer));
      if (data !== undefined) yield data;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function* readSSEJson(response: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  for await (const frame of readSSEFrames(response, signal)) {
    try { yield JSON.parse(frame) as unknown; }
    catch { throw new SseDecodeError("SSE data is not valid JSON", frame); }
  }
}

function parseSSEData(frame: string): string | undefined {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  return dataLines.length === 0 ? undefined : dataLines.join("\n");
}

function findDelimiter(bytes: Uint8Array): { index: number; length: number } | undefined {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10 && index + 3 < bytes.length && bytes[index + 2] === 13 && bytes[index + 3] === 10) return { index, length: 4 };
    if (bytes[index] === 10 && bytes[index + 1] === 10) return { index, length: 2 };
  }
  return undefined;
}

function concatBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
