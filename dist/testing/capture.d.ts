import type { FetchFunction } from "../transport.ts";
export interface CapturedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
}
export interface CapturedResponse {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
}
export interface CaptureRecord {
    request: CapturedRequest;
    response?: CapturedResponse;
    events: unknown[];
}
export declare class CaptureHarness {
    readonly records: CaptureRecord[];
    fetch(baseFetch: FetchFunction): FetchFunction;
    recordEvent(event: unknown): void;
    toJSON(): CaptureRecord[];
}
export declare function scrubSecrets(value: unknown): unknown;
//# sourceMappingURL=capture.d.ts.map