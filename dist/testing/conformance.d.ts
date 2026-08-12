import type { FetchFunction } from "../transport.ts";
export type ConformanceCheckStatus = "passed" | "failed" | "skipped";
export interface ConformanceCheck {
    name: string;
    status: ConformanceCheckStatus;
    durationMs: number;
    detail?: string;
}
export interface ConformanceReport {
    passed: boolean;
    checks: ConformanceCheck[];
    protocolVersion?: number;
    sessionId?: string;
}
export interface ConformanceSuiteOptions {
    baseURL: string;
    token: string;
    fetch?: FetchFunction;
    clientId?: string;
    owner?: string;
}
export declare class ConformanceError extends Error {
    readonly report: ConformanceReport;
    constructor(report: ConformanceReport);
}
/**
 * A small, read-safe protocol smoke suite for a running DoMoCode server.
 *
 * The suite creates and disposes one session, but never starts a model turn by
 * default. This makes it suitable for CI against a server configured with a
 * scripted gateway as well as for diagnosing a remote deployment without
 * consuming model quota. It deliberately uses only the public client surface.
 */
export declare class ConformanceSuite {
    private readonly options;
    constructor(options: ConformanceSuiteOptions);
    run(): Promise<ConformanceReport>;
    assert(): Promise<ConformanceReport>;
    private check;
    private skip;
}
//# sourceMappingURL=conformance.d.ts.map