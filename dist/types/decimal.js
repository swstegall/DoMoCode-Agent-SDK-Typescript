const DECIMAL = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export class ExactDecimal {
    coefficient;
    scale;
    constructor(coefficient, scale) {
        if (!Number.isInteger(scale) || scale < 0)
            throw new RangeError("Decimal scale must be a non-negative integer");
        let normalized = coefficient;
        let normalizedScale = scale;
        while (normalizedScale > 0 && normalized % 10n === 0n) {
            normalized /= 10n;
            normalizedScale -= 1;
        }
        this.coefficient = normalized;
        this.scale = normalizedScale;
    }
    add(other) {
        const scale = Math.max(this.scale, other.scale);
        const left = this.coefficient * 10n ** BigInt(scale - this.scale);
        const right = other.coefficient * 10n ** BigInt(scale - other.scale);
        return new ExactDecimal(left + right, scale);
    }
    toString() {
        if (this.coefficient === 0n)
            return "0";
        const sign = this.coefficient < 0n ? "-" : "";
        const digits = (this.coefficient < 0n ? -this.coefficient : this.coefficient).toString();
        if (this.scale === 0)
            return `${sign}${digits}`;
        const split = digits.length - this.scale;
        if (split <= 0)
            return `${sign}0.${"0".repeat(-split)}${digits}`;
        return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
    }
    valueOf() {
        throw new TypeError("ExactDecimal cannot be coerced to a floating-point number");
    }
}
export function parseDecimal(value) {
    if (!DECIMAL.test(value))
        throw new SyntaxError(`Invalid decimal string: ${value}`);
    const sign = value.startsWith("-") ? -1n : 1n;
    const unsigned = value.replace(/^[+-]/, "");
    const [mantissa = "", exponentText] = unsigned.split(/[eE]/);
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    const [whole, fraction = ""] = mantissa.split(".");
    const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
    const scale = fraction.length - exponent;
    if (scale < 0)
        return new ExactDecimal(sign * BigInt(digits) * 10n ** BigInt(-scale), 0);
    return new ExactDecimal(sign * BigInt(digits), scale);
}
export function asDecimalString(value) {
    parseDecimal(value);
    return value;
}
//# sourceMappingURL=decimal.js.map