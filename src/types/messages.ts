import type { JSONValue, OpenEnum } from "./common.ts";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./common.ts";

export interface ImageBlock {
  mediaType: string;
  /** Base64-encoded bytes, matching the Swift server's wire representation. */
  data: string;
}

export interface TextBlock { type: "text"; text: string }
export interface ReasoningBlock { type: "reasoning"; text: string; signature?: string }
export interface ToolCallBlock { type: "toolCall"; id: string; name: string; arguments: JSONValue }
export interface ToolResultBlock {
  type: "toolResult";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  images?: ImageBlock[];
}
export interface ContentImageBlock extends ImageBlock { type: "image" }
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

export interface SystemMessage { role: "system"; content: string }
export interface UserMessage { role: "user"; content: ContentBlock[] }
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

function decodeImage(value: unknown): ImageBlock {
  if (!isRecord(value)) throw new TypeError("Image block must be an object");
  return { mediaType: requiredString(value.mediaType, "mediaType"), data: requiredString(value.data, "data") };
}

export function decodeContentBlock(value: unknown): ContentBlock {
  if (!isRecord(value)) throw new TypeError("Content block must be an object");
  const type = requiredString(value.type, "content.type");
  switch (type) {
    case "text": return { type, text: requiredString(value.text, "text") };
    case "reasoning": return { type, text: requiredString(value.text, "reasoning.text"), ...(value.signature === undefined ? {} : { signature: requiredString(value.signature, "signature") }) };
    case "toolCall": return { type, id: requiredString(value.id, "toolCall.id"), name: requiredString(value.name, "toolCall.name"), arguments: (value.arguments ?? {}) as JSONValue };
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

function decodeUsage(value: unknown): Usage {
  if (!isRecord(value)) throw new TypeError("Assistant usage must be an object");
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

export function decodeMessage(value: unknown): Message {
  if (!isRecord(value)) throw new TypeError("Message must be an object");
  const role = requiredString(value.role, "message.role");
  if (role === "system") return { role, content: requiredString(value.content, "system.content") };
  if (role === "tool") return {
    role,
    toolCallId: requiredString(value.toolCallId, "toolCallId"),
    toolName: requiredString(value.toolName, "toolName"),
    output: requiredString(value.output, "output"),
    isError: requiredBoolean(value.isError, "isError"),
    ...(value.images === undefined ? {} : { images: requiredArray(value.images, "images").map(decodeImage) })
  };
  const content = requiredArray(value.content, `${role}.content`).map(decodeContentBlock);
  if (role === "user") return { role, content };
  if (role === "assistant") return {
    role,
    content,
    model: requiredString(value.model, "model"),
    ...(value.responseModel === undefined ? {} : { responseModel: requiredString(value.responseModel, "responseModel") }),
    ...(value.responseId === undefined ? {} : { responseId: requiredString(value.responseId, "responseId") }),
    usage: decodeUsage(value.usage),
    stopReason: requiredString(value.stopReason, "stopReason") as StopReason,
    ...(value.errorMessage === undefined ? {} : { errorMessage: requiredString(value.errorMessage, "errorMessage") })
  };
  throw new TypeError(`Unknown message role: ${role}`);
}

export function messageText(message: Message): string {
  if (message.role === "system") return message.content;
  if (message.role === "tool") return message.output;
  return message.content.filter((block): block is TextBlock => block.type === "text").map((block) => block.text).join("");
}
