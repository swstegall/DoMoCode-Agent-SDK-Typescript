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
export class DoMoApiError extends DoMoError {
    status;
    route;
    body;
    hint;
    constructor(message, options) {
        super(message, { cause: options.cause });
        this.name = "DoMoApiError";
        this.status = options.status;
        this.route = options.route;
        this.body = options.body;
        this.hint = options.hint;
    }
    toString() {
        const detail = this.body ? `: ${redactSecrets(this.body)}` : "";
        return `${this.name} ${this.status} ${this.route}${detail}`;
    }
}
export class UnauthorizedError extends DoMoApiError {
    constructor(options) { super("DoMoCode rejected the bearer token.", options); this.name = "UnauthorizedError"; }
}
export class ForbiddenError extends DoMoApiError {
    constructor(options) { super("DoMoCode refused the operation.", options); this.name = "ForbiddenError"; }
}
export class NotFoundError extends DoMoApiError {
    constructor(options) { super("DoMoCode could not find the requested resource.", options); this.name = "NotFoundError"; }
}
export class ConflictError extends DoMoApiError {
    constructor(options) { super("DoMoCode reported a state conflict.", options); this.name = "ConflictError"; }
}
export class PayloadTooLargeError extends DoMoApiError {
    constructor(options) { super("The request body exceeds the DoMoCode limit.", options); this.name = "PayloadTooLargeError"; }
}
export class StoreBusyError extends ConflictError {
    constructor(options) { super(options); this.name = "StoreBusyError"; }
}
export class RequestTimeoutError extends DoMoError {
    route;
    constructor(route, options) { super(`DoMoCode request timed out: ${route}`, options); this.name = "RequestTimeoutError"; this.route = route; }
}
export class AttachRejectedError extends DoMoApiError {
    sessionId;
    constructor(sessionId, options) { super("The session was created but ledger attachment was rejected.", options); this.name = "AttachRejectedError"; this.sessionId = sessionId; }
}
export class AuthorityUnavailableError extends DoMoError {
    sessionId;
    holder;
    constructor(sessionId, holder) { super(`Session ${sessionId} is attached to another authority client.`); this.name = "AuthorityUnavailableError"; this.sessionId = sessionId; this.holder = holder; }
}
export class SessionBusyError extends DoMoApiError {
    constructor(options) { super("The DoMoCode session is busy.", options); this.name = "SessionBusyError"; }
}
export class RunStateRaceError extends DoMoError {
    route;
    constructor(route) { super(`The session changed run state while sending through ${route}; the one permitted route flip was exhausted.`); this.name = "RunStateRaceError"; this.route = route; }
}
export class SessionAlreadyAcquiredError extends DoMoError {
    sessionId;
    constructor(sessionId) { super(`Session ${sessionId} is already acquired exclusively in this process.`); this.name = "SessionAlreadyAcquiredError"; this.sessionId = sessionId; }
}
export class RunStalledError extends DoMoError {
    pendingInteractions;
    constructor(pendingInteractions) { super("The run is waiting for an unanswered interaction."); this.name = "RunStalledError"; this.pendingInteractions = pendingInteractions; }
}
export function redactSecrets(value) {
    return value
        .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/([?&](?:token|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]");
}
//# sourceMappingURL=errors.js.map