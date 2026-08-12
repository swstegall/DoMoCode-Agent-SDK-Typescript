export type JSONPrimitive = string | number | boolean | null;
export interface JSONObject {
    [key: string]: JSONValue;
}
export type JSONValue = JSONPrimitive | JSONValue[] | JSONObject;
export type OpenEnum<Known extends string> = Known | (string & {});
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function requiredString(value: unknown, field: string): string;
export declare function optionalString(value: unknown): string | undefined;
export declare function requiredBoolean(value: unknown, field: string): boolean;
export declare function requiredNumber(value: unknown, field: string): number;
export declare function requiredArray(value: unknown, field: string): unknown[];
export declare function jsonObject(value: unknown, field: string): Record<string, unknown>;
//# sourceMappingURL=common.d.ts.map