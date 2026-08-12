export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface TransportOptions {
    baseURL: string;
    token: string;
    clientId?: string;
    owner?: string;
    fetch?: FetchFunction;
    requestTimeoutMs?: number;
    maxBodyBytes?: number;
}
export interface RequestOptions<T> {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
    stream?: boolean;
    headers?: Record<string, string>;
    decode?: (value: unknown) => T;
    expectedStatus?: number | readonly number[];
}
export declare function encodePathSegment(value: string): string;
export declare class Transport {
    readonly baseURL: string;
    readonly clientId: string;
    readonly owner: string;
    private readonly token;
    private readonly fetchFunction;
    private readonly requestTimeoutMs;
    private readonly maxBodyBytes;
    constructor(options: TransportOptions);
    json<T>(path: string, options?: RequestOptions<T>): Promise<T>;
    request(path: string, options?: RequestOptions<unknown>): Promise<Response>;
    private url;
    private encodeBody;
    private validateImages;
    private errorFor;
}
//# sourceMappingURL=transport.d.ts.map