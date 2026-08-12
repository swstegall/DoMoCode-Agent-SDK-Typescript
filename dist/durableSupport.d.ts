import type { RequestOptions } from "./transport.ts";
import type { JSONValue } from "./types/common.ts";
export interface DurableRequestOptions {
    signal?: AbortSignal;
}
export declare function signalOptions(signal: AbortSignal | undefined): Pick<RequestOptions<unknown>, "signal">;
export declare function object(value: unknown, field: string): Record<string, unknown>;
export declare function metadata(value: unknown, field: string): Record<string, JSONValue>;
export declare function strings(value: unknown, field: string): string[];
export declare function requiredAlias(record: Record<string, unknown>, field: string, ...keys: string[]): string;
export declare function optionalString(value: unknown, field: string): string | undefined;
export declare function optionalNumber(value: unknown, field: string): number | undefined;
export declare function first(record: Record<string, unknown>, keys: string[]): unknown;
export declare function nonNegativeCursor(value: number, field?: string): number;
export declare function optionalField<T>(value: T | undefined, key: string): Record<string, T>;
//# sourceMappingURL=durableSupport.d.ts.map