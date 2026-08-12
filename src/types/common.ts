export type JSONPrimitive = string | number | boolean | null;

export interface JSONObject {
  [key: string]: JSONValue;
}

export type JSONValue = JSONPrimitive | JSONValue[] | JSONObject;

export type OpenEnum<Known extends string> = Known | (string & {});

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`Expected ${field} to be a string`);
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value, "optional value");
}

export function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Expected ${field} to be a boolean`);
  return value;
}

export function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Expected ${field} to be a finite number`);
  return value;
}

export function requiredArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Expected ${field} to be an array`);
  return value;
}

export function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Expected ${field} to be an object`);
  return value;
}
