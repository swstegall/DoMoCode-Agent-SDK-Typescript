import { isRecord, requiredArray, requiredNumber, requiredString } from "./types/common.js";
export function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
export function object(value, field) {
    if (!isRecord(value))
        throw new TypeError(`${field} must be an object`);
    return value;
}
export function metadata(value, field) {
    if (value === undefined || value === null)
        return {};
    if (!isRecord(value))
        throw new TypeError(`${field} must be an object`);
    return value;
}
export function strings(value, field) {
    return requiredArray(value, field).map((item) => requiredString(item, field));
}
export function requiredAlias(record, field, ...keys) {
    return requiredString(first(record, keys), field);
}
export function optionalString(value, field) {
    return value === undefined || value === null ? undefined : requiredString(value, field);
}
export function optionalNumber(value, field) {
    return value === undefined || value === null ? undefined : requiredNumber(value, field);
}
export function first(record, keys) {
    for (const key of keys)
        if (record[key] !== undefined && record[key] !== null)
            return record[key];
    return undefined;
}
export function nonNegativeCursor(value, field = "after") {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(`${field} must be a non-negative integer`);
    return value;
}
export function optionalField(value, key) {
    return value === undefined ? {} : { [key]: value };
}
//# sourceMappingURL=durableSupport.js.map