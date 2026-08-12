import type { ServerEventName as GeneratedServerEventName } from "./generated.ts";
import type { JSONValue, OpenEnum } from "./common.ts";
import { isRecord, jsonObject, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./common.ts";
import type { Message } from "./messages.ts";
import { decodeMessage } from "./messages.ts";
import type { PermissionRequest, QuestionPrompt } from "./asks.ts";

export type ServerEventName = GeneratedServerEventName;
export type AgentEndReason = OpenEnum<"completed" | "errored" | "aborted" | "max_turns_reached" | "stopped_by_hook" | "terminated_by_tool" | "no_progress" | "cost_limit_reached">;
export type NoticeLevel = OpenEnum<"info" | "warning" | "error">;
export type QueueMode = OpenEnum<"all" | "one-at-a-time">;
export type SubagentStatus = OpenEnum<"started" | "accepted" | "running" | "completed" | "failed" | "cancelled">;

export interface ConnectedEvent { type: "connected"; protocolVersion: number; sessionId: string; running?: boolean }
export interface HeartbeatEvent { type: "heartbeat" }
export interface AgentStartEvent { type: "agent_start" }
export interface AgentEndEvent { type: "agent_end"; reason: AgentEndReason; runId?: string }
export interface TurnStartEvent { type: "turn_start" }
export interface TurnEndEvent { type: "turn_end" }
export interface MessageStartEvent { type: "message_start"; message: Message }
export interface MessageDeltaEvent { type: "message_delta"; text?: string; reasoning?: string }
export interface MessageEndEvent { type: "message_end"; message: Message }
export interface ToolStartEvent { type: "tool_start"; id: string; name: string; arguments: JSONValue }
export interface ToolEndEvent { type: "tool_end"; id: string; name: string; output: string; isError: boolean; imageCount: number }
export interface PermissionRequestEvent extends PermissionRequest { type: "permission_request" }
export interface PermissionResolvedEvent { type: "permission_resolved"; id: string }
export interface QuestionRequestEvent { type: "question_request"; id: string; sessionId: string; questions: QuestionPrompt[] }
export interface QuestionResolvedEvent { type: "question_resolved"; id: string }
export interface QueueUpdateEvent { type: "queue_update"; count: number; mode: QueueMode }
export interface ServerNotice { level: NoticeLevel; code: string; text: string; detail?: string; kind?: string; ttlMilliseconds?: number; recovery?: Record<string, unknown> }
export interface NoticeEvent { type: "notice"; notice: ServerNotice }
export interface SubagentTaskEvent {
  taskId: string;
  childSessionId: string;
  depth: number;
  status: SubagentStatus;
  parentSessionId?: string;
  description?: string;
  prompt?: string;
  agent?: string;
  mode?: string;
  model?: string;
  toolAllowlist?: string[];
  output?: string;
  error?: string;
}
export interface SubagentEvent { type: "subagent"; subagent: SubagentTaskEvent }
export interface McpChangedEvent { type: "mcp_changed"; server: string }
export interface UnknownEvent { type: string; raw: unknown; sequence?: number }

export type ServerEvent = ConnectedEvent | HeartbeatEvent | AgentStartEvent | AgentEndEvent | TurnStartEvent | TurnEndEvent | MessageStartEvent | MessageDeltaEvent | MessageEndEvent | ToolStartEvent | ToolEndEvent | PermissionRequestEvent | PermissionResolvedEvent | QuestionRequestEvent | QuestionResolvedEvent | QueueUpdateEvent | NoticeEvent | SubagentEvent | McpChangedEvent | UnknownEvent;
export type SequencedServerEvent = ServerEvent & { sequence: number };

export class WireDecodeError extends TypeError {
  readonly value: unknown;
  constructor(message: string, value: unknown) {
    super(message);
    this.name = "WireDecodeError";
    this.value = value;
  }
}

function decodeQuestion(value: unknown): QuestionPrompt {
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

export function decodeServerEvent(value: unknown): ServerEvent {
  if (!isRecord(value)) throw new WireDecodeError("SSE frame must be an object", value);
  const type = value.type;
  if (typeof type !== "string") throw new WireDecodeError("SSE frame type must be a string", value);
  switch (type) {
    case "connected": return { type, protocolVersion: requiredNumber(value.protocolVersion, "protocolVersion"), sessionId: requiredString(value.sessionId, "sessionId"), ...(value.running === undefined ? {} : { running: requiredBoolean(value.running, "running") }) };
    case "heartbeat": return { type };
    case "agent_start": return { type };
    case "agent_end": return { type, reason: requiredString(value.reason, "reason") as AgentEndReason, ...(value.runId === undefined ? {} : { runId: requiredString(value.runId, "runId") }) };
    case "turn_start": return { type };
    case "turn_end": return { type };
    case "message_start": return { type, message: decodeMessage(value.message) };
    case "message_delta": return {
      type,
      ...(value.text === undefined ? {} : { text: requiredString(value.text, "text") }),
      ...(value.reasoning === undefined ? {} : { reasoning: requiredString(value.reasoning, "reasoning") })
    };
    case "message_end": return { type, message: decodeMessage(value.message) };
    case "tool_start": return { type, id: requiredString(value.id, "id"), name: requiredString(value.name, "name"), arguments: (value.arguments ?? {}) as JSONValue };
    case "tool_end": return { type, id: requiredString(value.id, "id"), name: requiredString(value.name, "name"), output: requiredString(value.output, "output"), isError: requiredBoolean(value.isError, "isError"), imageCount: requiredNumber(value.imageCount, "imageCount") };
    case "permission_request": return {
      type,
      id: requiredString(value.id, "id"),
      sessionId: requiredString(value.sessionId, "sessionId"),
      permission: requiredString(value.permission, "permission"),
      patterns: requiredArray(value.patterns, "patterns").map((item) => requiredString(item, "pattern")),
      always: requiredArray(value.always, "always").map((item) => requiredString(item, "always pattern")),
      metadata: jsonObject(value.metadata, "metadata") as PermissionRequest["metadata"],
      disableAlways: requiredBoolean(value.disableAlways, "disableAlways")
    };
    case "permission_resolved": return { type, id: requiredString(value.id, "id") };
    case "question_request": return { type, id: requiredString(value.id, "id"), sessionId: requiredString(value.sessionId, "sessionId"), questions: requiredArray(value.questions, "questions").map(decodeQuestion) };
    case "question_resolved": return { type, id: requiredString(value.id, "id") };
    case "queue_update": return { type, count: requiredNumber(value.count, "count"), mode: requiredString(value.mode, "mode") as QueueMode };
    case "notice": {
      const notice = jsonObject(value.notice, "notice");
      return { type, notice: { level: requiredString(notice.level, "notice.level") as NoticeLevel, code: requiredString(notice.code, "notice.code"), text: requiredString(notice.text, "notice.text"), ...(notice.detail === undefined ? {} : { detail: requiredString(notice.detail, "notice.detail") }), ...(notice.kind === undefined ? {} : { kind: requiredString(notice.kind, "notice.kind") }), ...(notice.ttlMilliseconds === undefined ? {} : { ttlMilliseconds: requiredNumber(notice.ttlMilliseconds, "notice.ttlMilliseconds") }), ...(notice.recovery === undefined ? {} : { recovery: jsonObject(notice.recovery, "notice.recovery") }) } };
    }
    case "subagent": {
      const subagent = jsonObject(value.subagent, "subagent");
      return { type, subagent: {
        taskId: requiredString(subagent.taskId, "taskId"),
        childSessionId: requiredString(subagent.childSessionId, "childSessionId"),
        depth: requiredNumber(subagent.depth, "depth"),
        status: requiredString(subagent.status, "status") as SubagentStatus,
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
    default: return { type, raw: value };
  }
}

export function decodeSequencedServerEvent(value: unknown): SequencedServerEvent {
  if (!isRecord(value)) throw new WireDecodeError("Sequenced event must be an object", value);
  const sequence = requiredNumber(value.sequence, "sequence");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new WireDecodeError("Event sequence must be a positive integer", value);
  return { ...decodeServerEvent(value), sequence } as SequencedServerEvent;
}

export function isInteractionRequest(event: ServerEvent): event is PermissionRequestEvent | QuestionRequestEvent {
  return event.type === "permission_request" || event.type === "question_request";
}
