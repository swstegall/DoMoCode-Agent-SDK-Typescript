export class DoMoError extends Error {
    cause;
    constructor(message, options) {
        super(message, options);
        this.name = "DoMoError";
        this.cause = options?.cause;
    }
}
export class WireValidationError extends DoMoError {
    value;
    constructor(message, value) {
        super(message);
        this.name = "WireValidationError";
        this.value = value;
    }
}
//# sourceMappingURL=errors.js.map