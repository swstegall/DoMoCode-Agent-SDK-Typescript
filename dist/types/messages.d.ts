import type { JSONValue, OpenEnum } from "./common.ts";
export interface ImageBlock {
    mediaType: string;
    /** Base64-encoded bytes, matching the Swift server's wire representation. */
    data: string;
}
export interface TextBlock {
    type: "text";
    text: string;
}
export interface ReasoningBlock {
    type: "reasoning";
    text: string;
    signature?: string;
}
export interface ToolCallBlock {
    type: "toolCall";
    id: string;
    name: string;
    arguments: JSONValue;
}
export interface ToolResultBlock {
    type: "toolResult";
    toolCallId: string;
    toolName: string;
    output: string;
    isError: boolean;
    images?: ImageBlock[];
}
export interface ContentImageBlock extends ImageBlock {
    type: "image";
}
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ToolResultBlock | ContentImageBlock;
export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    cost: {
        input: string;
        output: string;
        cacheRead: string;
        cacheWrite: string;
    };
    reportedCost?: string;
}
export type StopReason = OpenEnum<"stop" | "length" | "toolUse" | "error" | "aborted">;
export interface SystemMessage {
    role: "system";
    content: string;
}
export interface UserMessage {
    role: "user";
    content: ContentBlock[];
}
export interface AssistantMessage {
    role: "assistant";
    content: ContentBlock[];
    model: string;
    responseModel?: string;
    responseId?: string;
    usage: Usage;
    stopReason: StopReason;
    errorMessage?: string;
}
export interface ToolMessage {
    role: "tool";
    toolCallId: string;
    toolName: string;
    output: string;
    isError: boolean;
    images?: ImageBlock[];
}
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
export declare function decodeContentBlock(value: unknown): ContentBlock;
export declare function decodeMessage(value: unknown): Message;
export declare function messageText(message: Message): string;
//# sourceMappingURL=messages.d.ts.map