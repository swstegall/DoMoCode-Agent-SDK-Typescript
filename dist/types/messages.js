import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./common.js";
function decodeImage(value) {
    if (!isRecord(value))
        throw new TypeError("Image block must be an object");
    return { mediaType: requiredString(value.mediaType, "mediaType"), data: requiredString(value.data, "data") };
}
export function decodeContentBlock(value) {
    if (!isRecord(value))
        throw new TypeError("Content block must be an object");
    const type = requiredString(value.type, "content.type");
    switch (type) {
        case "text": return { type, text: requiredString(value.text, "text") };
        case "reasoning": return { type, text: requiredString(value.text, "reasoning.text"), ...(value.signature === undefined ? {} : { signature: requiredString(value.signature, "signature") }) };
        case "toolCall": return { type, id: requiredString(value.id, "toolCall.id"), name: requiredString(value.name, "toolCall.name"), arguments: (value.arguments ?? {}) };
        case "toolResult": return {
            type,
            toolCallId: requiredString(value.toolCallId, "toolCallId"),
            toolName: requiredString(value.toolName, "toolName"),
            output: requiredString(value.output, "output"),
            isError: requiredBoolean(value.isError, "isError"),
            ...(value.images === undefined ? {} : { images: requiredArray(value.images, "images").map(decodeImage) })
        };
        case "image": return { type, ...decodeImage(value) };
        default: throw new TypeError(`Unknown content block type: ${type}`);
    }
}
function decodeUsage(value) {
    if (!isRecord(value))
        throw new TypeError("Assistant usage must be an object");
    const cost = isRecord(value.cost) ? value.cost : {};
    return {
        input: requiredNumber(value.input, "usage.input"),
        output: requiredNumber(value.output, "usage.output"),
        cacheRead: requiredNumber(value.cacheRead, "usage.cacheRead"),
        cacheWrite: requiredNumber(value.cacheWrite, "usage.cacheWrite"),
        ...(value.reasoning === undefined ? {} : { reasoning: requiredNumber(value.reasoning, "usage.reasoning") }),
        cost: {
            input: requiredString(cost.input ?? "0", "cost.input"),
            output: requiredString(cost.output ?? "0", "cost.output"),
            cacheRead: requiredString(cost.cacheRead ?? "0", "cost.cacheRead"),
            cacheWrite: requiredString(cost.cacheWrite ?? "0", "cost.cacheWrite")
        },
        ...(value.reportedCost === undefined ? {} : { reportedCost: requiredString(value.reportedCost, "reportedCost") })
    };
}
export function decodeMessage(value) {
    if (!isRecord(value))
        throw new TypeError("Message must be an object");
    const role = requiredString(value.role, "message.role");
    if (role === "system")
        return { role, content: requiredString(value.content, "system.content") };
    if (role === "tool")
        return {
            role,
            toolCallId: requiredString(value.toolCallId, "toolCallId"),
            toolName: requiredString(value.toolName, "toolName"),
            output: requiredString(value.output, "output"),
            isError: requiredBoolean(value.isError, "isError"),
            ...(value.images === undefined ? {} : { images: requiredArray(value.images, "images").map(decodeImage) })
        };
    const content = requiredArray(value.content, `${role}.content`).map(decodeContentBlock);
    if (role === "user")
        return { role, content };
    if (role === "assistant")
        return {
            role,
            content,
            model: requiredString(value.model, "model"),
            ...(value.responseModel === undefined ? {} : { responseModel: requiredString(value.responseModel, "responseModel") }),
            ...(value.responseId === undefined ? {} : { responseId: requiredString(value.responseId, "responseId") }),
            usage: decodeUsage(value.usage),
            stopReason: requiredString(value.stopReason, "stopReason"),
            ...(value.errorMessage === undefined ? {} : { errorMessage: requiredString(value.errorMessage, "errorMessage") })
        };
    throw new TypeError(`Unknown message role: ${role}`);
}
export function messageText(message) {
    if (message.role === "system")
        return message.content;
    if (message.role === "tool")
        return message.output;
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
//# sourceMappingURL=messages.js.map