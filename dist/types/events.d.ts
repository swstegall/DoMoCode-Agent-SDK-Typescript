import type { ServerEventName as GeneratedServerEventName } from "./generated.ts";
import type { JSONValue, OpenEnum } from "./common.ts";
import type { Message } from "./messages.ts";
import type { PermissionRequest, QuestionPrompt } from "./asks.ts";
export type ServerEventName = GeneratedServerEventName;
export type AgentEndReason = OpenEnum<"completed" | "errored" | "aborted" | "max_turns_reached" | "stopped_by_hook" | "terminated_by_tool" | "no_progress" | "cost_limit_reached">;
export type NoticeLevel = OpenEnum<"info" | "warning" | "error">;
export type QueueMode = OpenEnum<"all" | "one-at-a-time">;
export type SubagentStatus = OpenEnum<"started" | "accepted" | "running" | "completed" | "failed">;
export interface ConnectedEvent {
    type: "connected";
    protocolVersion: number;
    sessionId: string;
    running?: boolean;
}
export interface HeartbeatEvent {
    type: "heartbeat";
}
export interface AgentStartEvent {
    type: "agent_start";
}
export interface AgentEndEvent {
    type: "agent_end";
    reason: AgentEndReason;
    runId?: string;
}
export interface TurnStartEvent {
    type: "turn_start";
}
export interface TurnEndEvent {
    type: "turn_end";
}
export interface MessageStartEvent {
    type: "message_start";
    message: Message;
}
export interface MessageDeltaEvent {
    type: "message_delta";
    text?: string;
    reasoning?: string;
}
export interface MessageEndEvent {
    type: "message_end";
    message: Message;
}
export interface ToolStartEvent {
    type: "tool_start";
    id: string;
    name: string;
    arguments: JSONValue;
}
export interface ToolEndEvent {
    type: "tool_end";
    id: string;
    name: string;
    output: string;
    isError: boolean;
    imageCount: number;
}
export interface PermissionRequestEvent extends PermissionRequest {
    type: "permission_request";
}
export interface PermissionResolvedEvent {
    type: "permission_resolved";
    id: string;
}
export interface QuestionRequestEvent {
    type: "question_request";
    id: string;
    sessionId: string;
    questions: QuestionPrompt[];
}
export interface QuestionResolvedEvent {
    type: "question_resolved";
    id: string;
}
export interface QueueUpdateEvent {
    type: "queue_update";
    count: number;
    mode: QueueMode;
}
export interface ServerNotice {
    level: NoticeLevel;
    code: string;
    text: string;
    detail?: string;
    kind?: string;
    ttlMilliseconds?: number;
    recovery?: Record<string, unknown>;
}
export interface NoticeEvent {
    type: "notice";
    notice: ServerNotice;
}
export interface SubagentTaskEvent {
    taskId: string;
    childSessionId: string;
    depth: number;
    status: SubagentStatus;
    prompt?: string;
    agent?: string;
    error?: string;
}
export interface SubagentEvent {
    type: "subagent";
    subagent: SubagentTaskEvent;
}
export interface UnknownEvent {
    type: string;
    raw: unknown;
    sequence?: number;
}
export type ServerEvent = ConnectedEvent | HeartbeatEvent | AgentStartEvent | AgentEndEvent | TurnStartEvent | TurnEndEvent | MessageStartEvent | MessageDeltaEvent | MessageEndEvent | ToolStartEvent | ToolEndEvent | PermissionRequestEvent | PermissionResolvedEvent | QuestionRequestEvent | QuestionResolvedEvent | QueueUpdateEvent | NoticeEvent | SubagentEvent | UnknownEvent;
export type SequencedServerEvent = ServerEvent & {
    sequence: number;
};
export declare class WireDecodeError extends TypeError {
    readonly value: unknown;
    constructor(message: string, value: unknown);
}
export declare function decodeServerEvent(value: unknown): ServerEvent;
export declare function decodeSequencedServerEvent(value: unknown): SequencedServerEvent;
export declare function isInteractionRequest(event: ServerEvent): event is PermissionRequestEvent | QuestionRequestEvent;
//# sourceMappingURL=events.d.ts.map