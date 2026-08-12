import type { JSONValue } from "./common.ts";
import type { ImageBlock } from "./messages.ts";
export interface ClientToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
}
export interface ClientToolCall {
    id: string;
    sessionId: string;
    name: string;
    arguments: JSONValue;
    signal: AbortSignal;
}
export interface ClientToolResult {
    output: string;
    isError?: boolean;
    images?: ImageBlock[];
}
export type ClientToolHandlerResult = ClientToolResult | string;
export type ClientToolHandler = (call: ClientToolCall) => Promise<ClientToolHandlerResult> | ClientToolHandlerResult;
export interface ClientToolHandlerOptions {
    /** Bound local handler execution; the server also enforces its own timeout. */
    timeoutMs?: number;
}
export declare function validateClientToolDefinitions(definitions: readonly ClientToolDefinition[]): ClientToolDefinition[];
export interface ReadToolInput {
    path: string;
    lineStart?: number;
    lineEnd?: number;
}
export interface WriteToolInput {
    path: string;
    content: string;
}
export interface EditToolInput {
    path: string;
    oldText: string;
    newText: string;
}
export interface ApplyPatchToolInput {
    patch: string;
}
export interface BashToolInput {
    command: string;
    timeout?: number;
}
export interface PathToolInput {
    path?: string;
}
export interface FindToolInput {
    pattern: string;
    path?: string;
    maxResults?: number;
}
export interface GrepToolInput {
    pattern: string;
    path?: string;
    include?: string;
    maxResults?: number;
}
export interface GlobToolInput {
    pattern: string;
    path?: string;
}
export interface TodoWriteToolInput {
    todos: Array<Record<string, JSONValue>>;
}
export interface FinishToolInput {
    message?: string;
}
export interface PlanExitToolInput {
    summary?: string;
}
export interface QuestionToolInput {
    questions: Array<Record<string, JSONValue>>;
}
export interface WebFetchToolInput {
    url: string;
}
export interface WebSearchToolInput {
    query: string;
}
export interface BackgroundProcessToolInput {
    command: string;
}
export interface InteractiveTerminalToolInput {
    command: string;
}
export interface TaskToolInput {
    prompt: string;
    agent?: string;
    background?: boolean;
    model?: string;
}
export interface SessionRecallToolInput {
    query: string;
}
export interface MemoryToolInput {
    action: string;
    content?: string;
    id?: string;
}
export interface McpResourceToolInput {
    server: string;
    uri: string;
}
export interface SkillToolInput {
    name: string;
    arguments?: Record<string, JSONValue>;
}
export type BuiltInToolInput = ReadToolInput | WriteToolInput | EditToolInput | ApplyPatchToolInput | BashToolInput | PathToolInput | FindToolInput | GrepToolInput | GlobToolInput | TodoWriteToolInput | FinishToolInput | PlanExitToolInput | QuestionToolInput | WebFetchToolInput | WebSearchToolInput | BackgroundProcessToolInput | InteractiveTerminalToolInput | TaskToolInput | SessionRecallToolInput | MemoryToolInput | McpResourceToolInput | SkillToolInput;
//# sourceMappingURL=tools.d.ts.map