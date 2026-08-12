import { redactSecrets, AttachRejectedError, ConflictError, DoMoApiError, ForbiddenError, NotFoundError, PayloadTooLargeError, RequestTimeoutError, StoreBusyError, UnauthorizedError, WireValidationError } from "./types/errors.js";
import { uuidv7 } from "./uuid.js";
const DEFAULT_BODY_BYTES = 4 * 1024 * 1024;
const PROMPT_BODY_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 8;
const ERROR_BODY_BYTES = 2048;
export function encodePathSegment(value) {
    return encodeURIComponent(value);
}
export class Transport {
    baseURL;
    clientId;
    owner;
    token;
    fetchFunction;
    requestTimeoutMs;
    maxBodyBytes;
    constructor(options) {
        if (!options.baseURL)
            throw new TypeError("baseURL is required");
        if (!options.token)
            throw new TypeError("token is required");
        this.baseURL = options.baseURL.replace(/\/$/, "");
        this.token = options.token;
        this.clientId = options.clientId ?? uuidv7();
        this.owner = options.owner ?? this.clientId;
        this.fetchFunction = options.fetch ?? ((input, init) => fetch(input, init));
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_BODY_BYTES;
    }
    async json(path, options = {}) {
        const response = await this.request(path, { ...options, stream: false });
        if (response.status === 204)
            return undefined;
        const text = await response.text();
        if (text.length === 0)
            return undefined;
        let value;
        try {
            value = JSON.parse(text);
        }
        catch (error) {
            throw new WireValidationError(`DoMoCode returned invalid JSON for ${path}`, text.slice(0, ERROR_BODY_BYTES));
        }
        return options.decode ? options.decode(value) : value;
    }
    async request(path, options = {}) {
        const method = options.method ?? "GET";
        const route = path.split("?", 1)[0] ?? path;
        const body = options.body === undefined ? undefined : this.encodeBody(path, options.body);
        const controller = new AbortController();
        let timeout;
        let removeAbortListener;
        const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
        if (!options.stream && timeoutMs > 0)
            timeout = setTimeout(() => controller.abort(new RequestTimeoutError(route)), timeoutMs);
        if (options.signal) {
            const abort = () => controller.abort(options.signal?.reason);
            if (options.signal.aborted)
                abort();
            else {
                options.signal.addEventListener("abort", abort, { once: true });
                removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
            }
        }
        const headers = {
            accept: "application/json",
            authorization: `Bearer ${this.token}`,
            "x-domocode-client-id": this.clientId,
            "x-domocode-client-owner": this.owner,
            ...options.headers
        };
        if (body !== undefined)
            headers["content-type"] = "application/json";
        try {
            let response;
            try {
                response = await this.fetchFunction(this.url(path), { method, headers, ...(body === undefined ? {} : { body }), signal: controller.signal });
            }
            catch (error) {
                if (controller.signal.aborted && timeout !== undefined && !options.signal?.aborted)
                    throw new RequestTimeoutError(route, { cause: error });
                throw error;
            }
            const expected = options.expectedStatus;
            const isExpected = expected === undefined ? response.status >= 200 && response.status < 300 : Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
            if (!isExpected)
                throw await this.errorFor(response, path);
            return response;
        }
        finally {
            if (timeout !== undefined)
                clearTimeout(timeout);
            removeAbortListener?.();
        }
    }
    url(path) {
        return new URL(path.startsWith("/") ? path.slice(1) : path, `${this.baseURL}/`);
    }
    encodeBody(path, body) {
        if (body === null || typeof body !== "object")
            throw new WireValidationError("JSON request bodies must be objects or arrays", body);
        if (path.endsWith("/prompt") || path.endsWith("/steer"))
            this.validateImages(body);
        let encoded;
        try {
            encoded = JSON.stringify(body);
        }
        catch (error) {
            throw new WireValidationError("Request body is not JSON-serializable", error);
        }
        const byteLength = new TextEncoder().encode(encoded).byteLength;
        const limit = path.endsWith("/prompt") || path.endsWith("/steer") ? PROMPT_BODY_BYTES : this.maxBodyBytes;
        if (byteLength > limit)
            throw new PayloadTooLargeError({ status: 413, route: path, body: `client-side body size ${byteLength} exceeds ${limit}` });
        return encoded;
    }
    validateImages(body) {
        if (!body || typeof body !== "object" || !("images" in body))
            return;
        const images = body.images;
        if (images === undefined)
            return;
        if (!Array.isArray(images))
            throw new WireValidationError("Prompt images must be an array", images);
        if (images.length > MAX_IMAGES)
            throw new PayloadTooLargeError({ status: 413, route: "/prompt", body: `prompt contains more than ${MAX_IMAGES} images` });
        const bytes = images.reduce((total, image) => {
            if (!image || typeof image !== "object" || typeof image.data !== "string")
                throw new WireValidationError("Images require base64 data", image);
            return total + Math.floor((image.data.length * 3) / 4);
        }, 0);
        if (bytes > MAX_IMAGE_BYTES)
            throw new PayloadTooLargeError({ status: 413, route: "/prompt", body: `image data exceeds ${MAX_IMAGE_BYTES} bytes` });
    }
    async errorFor(response, path) {
        const body = redactSecrets((await response.text()).slice(0, ERROR_BODY_BYTES));
        const options = { status: response.status, route: path, ...(body ? { body } : {}) };
        if (/storeBusy|store busy/i.test(body))
            return new StoreBusyError(options);
        switch (response.status) {
            case 401: return new UnauthorizedError(options);
            case 403: return new ForbiddenError(options);
            case 404: return new NotFoundError(options);
            case 409: return new ConflictError(options);
            case 413: return new PayloadTooLargeError(options);
            default: return new DoMoApiError(`DoMoCode returned HTTP ${response.status}.`, options);
        }
    }
}
//# sourceMappingURL=transport.js.map