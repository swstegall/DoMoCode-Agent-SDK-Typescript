import { type Transport } from "./transport.ts";
import type { WorkflowApprovalRequest, WorkflowDefinition, WorkflowEvidence, WorkflowRunRecord, WorkflowStageDefinition, WorkflowStageRunRecord, WorkflowStoreRecord } from "./types/durable.ts";
import type { JSONValue } from "./types/common.ts";
export interface WorkflowRequestOptions {
    signal?: AbortSignal;
}
export interface WorkflowRunOptions extends WorkflowRequestOptions {
    sessionId: string;
    input?: JSONValue;
    runId?: string;
}
export type WorkflowApprovalDecision = "approve" | "approved" | "deny" | "denied" | "cancel" | "cancelled" | (string & {});
/** REST client for the server-owned durable workflow state machine. */
export declare class WorkflowClient {
    private readonly transport;
    constructor(transport: Transport);
    definitions(options?: WorkflowRequestOptions): Promise<WorkflowDefinition[]>;
    list(options?: WorkflowRequestOptions): Promise<WorkflowDefinition[]>;
    runs(workflowId: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord[]>;
    records(workflowId: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord[]>;
    get(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
    run(workflowId: string, options: WorkflowRunOptions): Promise<WorkflowRunRecord>;
    run(workflowId: string, sessionId: string, input?: JSONValue, runId?: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
    resume(workflowId: string, runId: string, sessionId?: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
    cancel(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
    pause(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
    approvals(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowApprovalRequest[]>;
    decide(workflowId: string, runId: string, stageId: string, decision: WorkflowApprovalDecision, reason?: string, options?: WorkflowRequestOptions): Promise<void>;
    export(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowStoreRecord[]>;
    exportRun(workflowId: string, runId: string, options?: WorkflowRequestOptions): Promise<WorkflowStoreRecord[]>;
    private transition;
}
export declare function workflowPath(workflowId: string, suffix?: string): string;
export declare function decodeWorkflowDefinition(value: unknown): WorkflowDefinition;
export declare function decodeWorkflowStageDefinition(value: unknown): WorkflowStageDefinition;
export declare function decodeWorkflowRunRecord(value: unknown): WorkflowRunRecord;
export declare function decodeWorkflowStageRunRecord(value: unknown): WorkflowStageRunRecord;
export declare function decodeWorkflowEvidence(value: unknown): WorkflowEvidence;
export declare function decodeWorkflowApprovalRequest(value: unknown): WorkflowApprovalRequest;
export declare function decodeWorkflowStoreRecord(value: unknown): WorkflowStoreRecord;
//# sourceMappingURL=workflows.d.ts.map