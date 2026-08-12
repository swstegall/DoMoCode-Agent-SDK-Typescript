export class CaptureHarness {
    records = [];
    fetch(baseFetch) {
        return async (input, init) => {
            const request = await captureRequest(input, init);
            const record = { request, events: [] };
            this.records.push(record);
            const response = await baseFetch(input, init);
            record.response = { status: response.status, headers: Object.fromEntries(response.headers.entries()) };
            if (!response.body || request.url.includes("/events"))
                return response;
            const body = await response.clone().text();
            if (body) {
                try {
                    record.response.body = JSON.parse(body);
                }
                catch {
                    record.response.body = body;
                }
            }
            return response;
        };
    }
    recordEvent(event) {
        const last = this.records.at(-1);
        if (last)
            last.events.push(scrubSecrets(event));
    }
    toJSON() { return this.records.map((record) => scrubSecrets(record)); }
}
export function scrubSecrets(value) {
    if (Array.isArray(value))
        return value.map(scrubSecrets);
    if (!value || typeof value !== "object")
        return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        const sensitive = key.toLowerCase() === "authorization" || /token|api.?key/i.test(key);
        result[key] = sensitive ? "[REDACTED]" : scrubSecrets(item);
    }
    return result;
}
async function captureRequest(input, init) {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request = { method: init?.method ?? "GET", url: input instanceof Request ? input.url : input.toString(), headers: scrubSecrets(headers) };
    if (typeof init?.body === "string") {
        try {
            request.body = scrubSecrets(JSON.parse(init.body));
        }
        catch {
            request.body = "[non-json body]";
        }
    }
    return request;
}
//# sourceMappingURL=capture.js.map