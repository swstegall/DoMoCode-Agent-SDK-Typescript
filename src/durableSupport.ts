import type { RequestOptions } from "./transport.ts";
import { isRecord, requiredArray, requiredNumber, requiredString } from "./types/common.ts";
import type { JSONValue } from "./types/common.ts";

export interface DurableRequestOptions { signal?: AbortSignal }

export function signalOptions(signal: AbortSignal | undefined): Pick<RequestOptions<unknown>, "signal"> {
  return signal === undefined ? {} : { signal };
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value;
}

export function metadata(value: unknown, field: string): Record<string, JSONValue> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value as Record<string, JSONValue>;
}

export function strings(value: unknown, field: string): string[] {
  return requiredArray(value, field).map((item) => requiredString(item, field));
}

export function requiredAlias(record: Record<string, unknown>, field: string, ...keys: string[]): string {
  return requiredString(first(record, keys), field);
}

export function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value, field);
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : requiredNumber(value, field);
}

export function first(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

export function nonNegativeCursor(value: number, field = "after"): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

export function optionalField<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
