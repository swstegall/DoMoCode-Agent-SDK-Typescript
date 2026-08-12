import type { JSONValue, OpenEnum } from "./common.ts";
import type { Message } from "./messages.ts";
import { parseDecimal, type DecimalString, type ExactDecimal } from "./decimal.ts";

export interface SessionRef { id: string; path: string }
export interface SessionSummary { id: string; path: string; cwd: string; timestamp: string; name?: string; parentSession?: string }
export interface SessionAccounting { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costTotal: DecimalString; contextTokens?: number; contextWindow?: number }
export interface SessionStatus { sessionId: string; running: boolean; pendingPermissionIds: string[]; pendingQuestionIds?: string[]; subscribers: number; runStartedAt?: string; accounting?: SessionAccounting; queuedMessageCount?: number; steeringMode?: OpenEnum<"all" | "one-at-a-time">; mode?: string; agent?: string }
export interface ContextSnapshot { messages: Message[]; accounting?: SessionAccounting }
export interface DirectToolResult { toolName: string; output: string; isError: boolean; imageCount: number }
export interface SessionTreeEntry { id: string; parentId?: string; type?: string; title?: string; timestamp?: string; [key: string]: unknown }
export interface GitDiff { files: Array<Record<string, unknown>>; patch?: string; [key: string]: unknown }
export interface WorkspaceSnapshotStatus { [key: string]: unknown }
export interface WorkspaceHistoryResult { [key: string]: unknown }
export interface AbortResult { aborted: boolean }
export interface ForceClearResult { cleared: boolean }
export interface SessionTitleResult { title?: string }

export type ClientRole = "authority" | "observer" | OpenEnum<"detached">;
export interface SessionClientAttachment { clientId: string; owner: string; role: ClientRole; active: boolean; eventCursor?: number; lastSeenAt?: string }
export interface SessionClientEvent { sequence: number; kind: string; sessionId: string; clientId: string; owner: string; timestamp: string; [key: string]: unknown }
export interface SessionClientJournalEntry { event: SessionClientEvent; attachment: SessionClientAttachment }

export interface ServerCapabilities { name: string; version: string; protocolVersion: number; capabilities: string[] }
export interface RunResult {
  stopReason: string;
  messages: Message[];
  accounting?: SessionAccounting;
  notices: Array<{ level: string; code: string; text: string; detail?: string }>;
}

export function effectiveCostTotal(accounting: SessionAccounting | undefined): ExactDecimal | undefined {
  return accounting ? parseDecimal(accounting.costTotal) : undefined;
}
