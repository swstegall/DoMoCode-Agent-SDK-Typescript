import type { JSONValue, OpenEnum } from "./common.ts";
export interface CursorEvent {
    sequence: number;
    timestamp?: string;
    kind: string;
    [key: string]: unknown;
}
export interface WorkflowDefinition {
    id: string;
    name?: string;
    stages?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}
export interface WorkflowRunRecord {
    workflowId: string;
    runId: string;
    sessionId: string;
    state: OpenEnum<string>;
    [key: string]: unknown;
}
export interface WorkflowApproval {
    stageId: string;
    decision?: string;
    [key: string]: unknown;
}
export interface JobRecord {
    id: string;
    state: OpenEnum<string>;
    owner: string;
    output?: JSONValue;
    [key: string]: unknown;
}
export interface JobEvent extends CursorEvent {
    jobId: string;
}
export interface HandoffRecord {
    id: string;
    state: OpenEnum<string>;
    sourceSessionId: string;
    [key: string]: unknown;
}
export interface HandoffEvent extends CursorEvent {
    handoffId: string;
}
export interface AutomationDefinition {
    id: string;
    owner: string;
    enabled: boolean;
    [key: string]: unknown;
}
export interface AutomationInvocation {
    automationId: string;
    [key: string]: unknown;
}
export interface AutomationEvent extends CursorEvent {
    automationId: string;
}
//# sourceMappingURL=durable.d.ts.map