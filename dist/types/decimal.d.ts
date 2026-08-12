/** A decimal string as it crosses the REST wire. */
export type DecimalString = string & {
    readonly __decimalString: unique symbol;
};
export declare class ExactDecimal {
    readonly coefficient: bigint;
    readonly scale: number;
    constructor(coefficient: bigint, scale: number);
    add(other: ExactDecimal): ExactDecimal;
    toString(): string;
    valueOf(): never;
}
export declare function parseDecimal(value: string): ExactDecimal;
export declare function asDecimalString(value: string): DecimalString;
//# sourceMappingURL=decimal.d.ts.map