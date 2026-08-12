import { isRecord, jsonObject, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./common.js";
import { decodeMessage } from "./messages.js";
export class WireDecodeError extends TypeError {
    value;
    constructor(message, value) {
        super(message);
        this.name = "WireDecodeError";
        this.value = value;
    }
}
function decodeQuestion(value) {
    const object = jsonObject(value, "question");
    return {
        ...(object.header === undefined ? {} : { header: requiredString(object.header, "header") }),
        question: requiredString(object.question, "question"),
        options: requiredArray(object.options, "options").map((option) => {
            const item = jsonObject(option, "question option");
            return { label: requiredString(item.label, "label"), ...(item.description === undefined ? {} : { description: requiredString(item.description, "description") }) };
        }),
        allowsMultiple: requiredBoolean(object.allowsMultiple, "allowsMultiple")
    };
}
export function decodeServerEvent(value) {
    if (!isRecord(value))
        throw new WireDecodeError("SSE frame must be an object", value);
    const type = value.type;
    if (typeof type !== "string")
        throw new WireDecodeError("SSE frame type must be a string", value);
    switch (type) {
        case "connected": return { type, protocolVersion: requiredNumber(value.protocolVersion, "protocolVersion"), sessionId: requiredString(value.sessionId, "sessionId"), ...(value.running === undefined ? {} : { running: requiredBoolean(value.running, "running") }) };
        case "heartbeat": return { type };
        case "agent_start": return { type };
        case "agent_end": return { type, reason: requiredString(value.reason, "reason"), ...(value.runId === undefined ? {} : { runId: requiredString(value.runId, "runId") }) };
        case "turn_start": return { type };
        case "turn_end": return { type };
        case "message_start": return { type, message: decodeMessage(value.message) };
        case "message_delta": return {
            type,
            ...(value.text === undefined ? {} : { text: requiredString(value.text, "text") }),
            ...(value.reasoning === undefined ? {} : { reasoning: requiredString(value.reasoning, "reasoning") })
        };
        case "message_end": return { type, message: decodeMessage(value.message) };
        case "tool_start": return { type, id: requiredString(value.id, "id"), name: requiredString(value.name, "name"), arguments: (value.arguments ?? {}) };
        case "tool_end": return { type, id: requiredString(value.id, "id"), name: requiredString(value.name, "name"), output: requiredString(value.output, "output"), isError: requiredBoolean(value.isError, "isError"), imageCount: requiredNumber(value.imageCount, "imageCount") };
        case "permission_request": return {
            type,
            id: requiredString(value.id, "id"),
            sessionId: requiredString(value.sessionId, "sessionId"),
            permission: requiredString(value.permission, "permission"),
            patterns: requiredArray(value.patterns, "patterns").map((item) => requiredString(item, "pattern")),
            always: requiredArray(value.always, "always").map((item) => requiredString(item, "always pattern")),
            metadata: jsonObject(value.metadata, "metadata"),
            disableAlways: requiredBoolean(value.disableAlways, "disableAlways")
        };
        case "permission_resolved": return { type, id: requiredString(value.id, "id") };
        case "question_request": return { type, id: requiredString(value.id, "id"), sessionId: requiredString(value.sessionId, "sessionId"), questions: requiredArray(value.questions, "questions").map(decodeQuestion) };
        case "question_resolved": return { type, id: requiredString(value.id, "id") };
        case "queue_update": return { type, count: requiredNumber(value.count, "count"), mode: requiredString(value.mode, "mode") };
        case "notice": {
            const notice = jsonObject(value.notice, "notice");
            return { type, notice: { level: requiredString(notice.level, "notice.level"), code: requiredString(notice.code, "notice.code"), text: requiredString(notice.text, "notice.text"), ...(notice.detail === undefined ? {} : { detail: requiredString(notice.detail, "notice.detail") }), ...(notice.kind === undefined ? {} : { kind: requiredString(notice.kind, "notice.kind") }), ...(notice.ttlMilliseconds === undefined ? {} : { ttlMilliseconds: requiredNumber(notice.ttlMilliseconds, "notice.ttlMilliseconds") }), ...(notice.recovery === undefined ? {} : { recovery: jsonObject(notice.recovery, "notice.recovery") }) } };
        }
        case "subagent": {
            const subagent = jsonObject(value.subagent, "subagent");
            return { type, subagent: {
                    taskId: requiredString(subagent.taskId, "taskId"),
                    childSessionId: requiredString(subagent.childSessionId, "childSessionId"),
                    depth: requiredNumber(subagent.depth, "depth"),
                    status: requiredString(subagent.status, "status"),
                    ...(subagent.parentSessionId === undefined ? {} : { parentSessionId: requiredString(subagent.parentSessionId, "parentSessionId") }),
                    ...(subagent.description === undefined ? {} : { description: requiredString(subagent.description, "description") }),
                    ...(subagent.prompt === undefined ? {} : { prompt: requiredString(subagent.prompt, "prompt") }),
                    ...(subagent.agent === undefined ? {} : { agent: requiredString(subagent.agent, "agent") }),
                    ...(subagent.mode === undefined ? {} : { mode: requiredString(subagent.mode, "mode") }),
                    ...(subagent.model === undefined ? {} : { model: requiredString(subagent.model, "model") }),
                    ...(subagent.toolAllowlist === undefined ? {} : { toolAllowlist: requiredArray(subagent.toolAllowlist, "toolAllowlist").map((item) => requiredString(item, "tool allowlist entry")) }),
                    ...(subagent.output === undefined ? {} : { output: requiredString(subagent.output, "output") }),
                    ...(subagent.error === undefined ? {} : { error: requiredString(subagent.error, "error") })
                } };
        }
        case "mcp_changed": return { type, server: requiredString(value.server, "server") };
        case "oauth_request": return { type, id: requiredString(value.id, "id"), server: requiredString(value.server, "server"), authorizationUrl: requiredString(value.authorizationUrl, "authorizationUrl"), expiresAt: requiredString(value.expiresAt, "expiresAt") };
        case "oauth_resolved": return { type, id: requiredString(value.id, "id"), server: requiredString(value.server, "server"), status: requiredString(value.status, "status"), ...(value.error === undefined || value.error === null ? {} : { error: requiredString(value.error, "error") }) };
        default: return { type, raw: value };
    }
}
export function decodeSequencedServerEvent(value) {
    if (!isRecord(value))
        throw new WireDecodeError("Sequenced event must be an object", value);
    const sequence = requiredNumber(value.sequence, "sequence");
    if (!Number.isSafeInteger(sequence) || sequence < 1)
        throw new WireDecodeError("Event sequence must be a positive integer", value);
    return { ...decodeServerEvent(value), sequence };
}
export function isInteractionRequest(event) {
    return event.type === "permission_request" || event.type === "question_request";
}
//# sourceMappingURL=events.js.map