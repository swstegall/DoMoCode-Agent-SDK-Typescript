export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function requiredString(value, field) {
    if (typeof value !== "string")
        throw new TypeError(`Expected ${field} to be a string`);
    return value;
}
export function optionalString(value) {
    return value === undefined || value === null ? undefined : requiredString(value, "optional value");
}
export function requiredBoolean(value, field) {
    if (typeof value !== "boolean")
        throw new TypeError(`Expected ${field} to be a boolean`);
    return value;
}
export function requiredNumber(value, field) {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError(`Expected ${field} to be a finite number`);
    return value;
}
export function requiredArray(value, field) {
    if (!Array.isArray(value))
        throw new TypeError(`Expected ${field} to be an array`);
    return value;
}
export function jsonObject(value, field) {
    if (!isRecord(value))
        throw new TypeError(`Expected ${field} to be an object`);
    return value;
}
//# sourceMappingURL=common.js.map