import { encodePathSegment, type RequestOptions, type Transport } from "./transport.ts";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.ts";
import type {
  WorkflowApprovalRequest,
  WorkflowBudget,
  WorkflowDefinition,
  WorkflowEvidence,
  WorkflowRunRecord,
  WorkflowStageDefinition,
  WorkflowStageRunRecord,
  WorkflowStoreRecord,
  WorkflowToolPolicy,
  WorkflowToolPolicyMode
} from "./types/durable.ts";
import type { JSONValue } from "./types/common.ts";

export interface WorkflowRequestOptions { signal?: AbortSignal }

export interface WorkflowRunOptions extends WorkflowRequestOptions {
  sessionId: string;
  input?: JSONValue;
  runId?: string;
}

export type WorkflowApprovalDecision = "approve" | "approved" | "deny" | "denied" | "cancel" | "cancelled" | (string & {});

/** REST client for the server-owned durable workflow state machine. */
export class WorkflowClient {
  constructor(private readonly transport: Transport) {}

  async definitions(options: WorkflowRequestOptions = {}): Promise<WorkflowDefinition[]> {
    return requiredArray(await this.transport.json<unknown>("/workflows", { ...signalOptions(options.signal) }), "workflows").map(decodeWorkflowDefinition);
  }

  async list(options: WorkflowRequestOptions = {}): Promise<WorkflowDefinition[]> {
    return this.definitions(options);
  }

  async runs(workflowId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord[]> {
    const path = workflowPath(workflowId, "/runs");
    return requiredArray(await this.transport.json<unknown>(path, { ...signalOptions(options.signal) }), "workflow runs").map(decodeWorkflowRunRecord);
  }

  async records(workflowId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord[]> {
    return this.runs(workflowId, options);
  }

  async get(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord> {
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}`);
    return decodeWorkflowRunRecord(await this.transport.json<unknown>(path, { ...signalOptions(options.signal) }));
  }

  async run(workflowId: string, options: WorkflowRunOptions): Promise<WorkflowRunRecord>;
  async run(workflowId: string, sessionId: string, input?: JSONValue, runId?: string, options?: WorkflowRequestOptions): Promise<WorkflowRunRecord>;
  async run(
    workflowId: string,
    sessionIdOrOptions: string | WorkflowRunOptions,
    input: JSONValue = null,
    runId?: string,
    options: WorkflowRequestOptions = {}
  ): Promise<WorkflowRunRecord> {
    const request: WorkflowRunOptions = typeof sessionIdOrOptions === "string"
      ? { sessionId: sessionIdOrOptions, input, ...(runId === undefined ? {} : { runId }), ...options }
      : sessionIdOrOptions;
    const body: Record<string, unknown> = { sessionID: request.sessionId, input: request.input ?? null };
    if (request.runId !== undefined) body.runID = request.runId;
    const path = workflowPath(workflowId, "/run");
    return decodeWorkflowRunRecord(await this.transport.json<unknown>(path, {
      method: "POST",
      body,
      expectedStatus: 202,
      ...signalOptions(request.signal)
    }));
  }

  async resume(workflowId: string, runId: string, sessionId?: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord> {
    const body = sessionId === undefined ? {} : { sessionID: sessionId };
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/resume`);
    return decodeWorkflowRunRecord(await this.transport.json<unknown>(path, {
      method: "POST",
      body,
      expectedStatus: 202,
      ...signalOptions(options.signal)
    }));
  }

  async cancel(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord> {
    return this.transition(workflowId, runId, "cancel", options);
  }

  async pause(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowRunRecord> {
    return this.transition(workflowId, runId, "pause", options);
  }

  async approvals(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowApprovalRequest[]> {
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/approvals`);
    return requiredArray(await this.transport.json<unknown>(path, { ...signalOptions(options.signal) }), "workflow approvals").map(decodeWorkflowApprovalRequest);
  }

  async decide(
    workflowId: string,
    runId: string,
    stageId: string,
    decision: WorkflowApprovalDecision,
    reason?: string,
    options: WorkflowRequestOptions = {}
  ): Promise<void> {
    if (stageId.trim().length === 0) throw new TypeError("Workflow approval stageId must not be empty");
    const body = { stageID: stageId, decision, ...(reason === undefined ? {} : { reason }) };
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/approval`);
    await this.transport.json<unknown>(path, {
      method: "POST",
      body,
      expectedStatus: 200,
      ...signalOptions(options.signal)
    });
  }

  async export(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowStoreRecord[]> {
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/export`);
    return requiredArray(await this.transport.json<unknown>(path, { ...signalOptions(options.signal) }), "workflow export").map(decodeWorkflowStoreRecord);
  }

  async exportRun(workflowId: string, runId: string, options: WorkflowRequestOptions = {}): Promise<WorkflowStoreRecord[]> {
    return this.export(workflowId, runId, options);
  }

  private async transition(workflowId: string, runId: string, action: "cancel" | "pause", options: WorkflowRequestOptions): Promise<WorkflowRunRecord> {
    const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/${action}`);
    return decodeWorkflowRunRecord(await this.transport.json<unknown>(path, {
      method: "POST",
      expectedStatus: 200,
      ...signalOptions(options.signal)
    }));
  }
}

export function workflowPath(workflowId: string, suffix = ""): string {
  return `/workflow/${encodePathSegment(workflowId)}${suffix}`;
}

export function decodeWorkflowDefinition(value: unknown): WorkflowDefinition {
  const record = object(value, "workflow definition");
  return {
    ...record,
    id: requiredString(record.id, "workflow.id"),
    displayName: requiredString(record.displayName, "workflow.displayName"),
    version: requiredNumber(record.version, "workflow.version"),
    executionMode: requiredString(record.executionMode, "workflow.executionMode") as WorkflowDefinition["executionMode"],
    stages: requiredArray(record.stages, "workflow.stages").map(decodeWorkflowStageDefinition),
    metadata: metadata(record.metadata, "workflow.metadata")
  };
}

export function decodeWorkflowStageDefinition(value: unknown): WorkflowStageDefinition {
  const record = object(value, "workflow stage");
  const model = optionalString(record.model, "workflow stage.model");
  const profile = optionalString(record.profile, "workflow stage.profile");
  const outputArtifact = optionalString(record.outputArtifact, "workflow stage.outputArtifact");
  const timeoutSeconds = optionalNumber(record.timeoutSeconds, "workflow stage.timeoutSeconds");
  return {
    ...record,
    id: requiredString(record.id, "workflow stage.id"),
    displayName: requiredString(record.displayName, "workflow stage.displayName"),
    kind: requiredString(record.kind, "workflow stage.kind") as WorkflowStageDefinition["kind"],
    dependencies: strings(record.dependencies, "workflow stage.dependencies"),
    toolPolicy: decodeWorkflowToolPolicy(record.toolPolicy),
    ...(model === undefined ? {} : { model }),
    ...(profile === undefined ? {} : { profile }),
    contextInputs: strings(record.contextInputs, "workflow stage.contextInputs"),
    ...(outputArtifact === undefined ? {} : { outputArtifact }),
    budget: decodeWorkflowBudget(record.budget),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    cancellationPolicy: requiredString(record.cancellationPolicy, "workflow stage.cancellationPolicy") as WorkflowStageDefinition["cancellationPolicy"],
    approvalBoundary: requiredString(record.approvalBoundary, "workflow stage.approvalBoundary") as WorkflowStageDefinition["approvalBoundary"],
    metadata: metadata(record.metadata, "workflow stage.metadata")
  };
}

export function decodeWorkflowRunRecord(value: unknown): WorkflowRunRecord {
  const record = object(value, "workflow run");
  const error = optionalString(record.error, "workflow run.error");
  return {
    ...record,
    id: requiredString(record.id, "workflow run.id"),
    workflowId: requiredAlias(record, "workflow run.workflowId", "workflowID", "workflowId"),
    status: requiredString(record.status ?? record.state, "workflow run.status") as WorkflowRunRecord["status"],
    createdAt: requiredString(record.createdAt, "workflow run.createdAt"),
    updatedAt: requiredString(record.updatedAt, "workflow run.updatedAt"),
    input: (record.input ?? null) as JSONValue,
    stages: record.stages === undefined || record.stages === null ? [] : requiredArray(record.stages, "workflow run.stages").map(decodeWorkflowStageRunRecord),
    output: (record.output ?? null) as JSONValue,
    ...(error === undefined ? {} : { error }),
    cancellationRequested: record.cancellationRequested === undefined ? false : requiredBoolean(record.cancellationRequested, "workflow run.cancellationRequested"),
    metadata: metadata(record.metadata, "workflow run.metadata")
  };
}

export function decodeWorkflowStageRunRecord(value: unknown): WorkflowStageRunRecord {
  const record = object(value, "workflow stage run");
  const startedAt = optionalString(record.startedAt, "workflow stage run.startedAt");
  const finishedAt = optionalString(record.finishedAt, "workflow stage run.finishedAt");
  const error = optionalString(record.error, "workflow stage run.error");
  return {
    ...record,
    stageId: requiredAlias(record, "workflow stage run.stageId", "stageID", "stageId"),
    status: requiredString(record.status, "workflow stage run.status") as WorkflowStageRunRecord["status"],
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    output: (record.output ?? null) as JSONValue,
    ...(error === undefined ? {} : { error }),
    agentIds: stringsFromAliases(record, "workflow stage run.agentIds", "agentIDs", "agentIds"),
    evidence: record.evidence === undefined || record.evidence === null ? [] : requiredArray(record.evidence, "workflow stage run.evidence").map(decodeWorkflowEvidence),
    metadata: metadata(record.metadata, "workflow stage run.metadata")
  };
}

export function decodeWorkflowEvidence(value: unknown): WorkflowEvidence {
  const record = object(value, "workflow evidence");
  const sessionId = optionalString(record.sessionID ?? record.sessionId, "workflow evidence.sessionId");
  const locator = optionalString(record.locator, "workflow evidence.locator");
  return {
    ...record,
    id: requiredString(record.id, "workflow evidence.id"),
    stageId: requiredAlias(record, "workflow evidence.stageId", "stageID", "stageId"),
    source: requiredString(record.source, "workflow evidence.source"),
    ...(sessionId === undefined ? {} : { sessionId }),
    kind: requiredString(record.kind, "workflow evidence.kind") as WorkflowEvidence["kind"],
    untrustedData: requiredBoolean(record.untrustedData, "workflow evidence.untrustedData"),
    summary: requiredString(record.summary, "workflow evidence.summary"),
    ...(locator === undefined ? {} : { locator }),
    metadata: metadata(record.metadata, "workflow evidence.metadata")
  };
}

export function decodeWorkflowApprovalRequest(value: unknown): WorkflowApprovalRequest {
  const record = object(value, "workflow approval");
  const stage = record.stage ?? (record.stageId === undefined ? undefined : { id: record.stageId, displayName: record.stageId, kind: "execute", dependencies: [], toolPolicy: { mode: "readOnly", allowedTools: [] }, contextInputs: [], budget: {}, cancellationPolicy: "stopDependents", approvalBoundary: "none", metadata: {} });
  return {
    ...record,
    workflowId: requiredAlias(record, "workflow approval.workflowId", "workflowID", "workflowId"),
    runId: requiredAlias(record, "workflow approval.runId", "runID", "runId"),
    stage: decodeWorkflowStageDefinition(stage)
  };
}

export function decodeWorkflowStoreRecord(value: unknown): WorkflowStoreRecord {
  const record = object(value, "workflow store record");
  return {
    ...record,
    kind: requiredString(record.kind, "workflow store record.kind") as WorkflowStoreRecord["kind"],
    id: requiredString(record.id, "workflow store record.id"),
    timestamp: requiredString(record.timestamp, "workflow store record.timestamp"),
    ...(record.definition === undefined || record.definition === null ? {} : { definition: decodeWorkflowDefinition(record.definition) }),
    ...(record.run === undefined || record.run === null ? {} : { run: decodeWorkflowRunRecord(record.run) })
  };
}

function decodeWorkflowToolPolicy(value: unknown): WorkflowToolPolicy {
  if (value === undefined || value === null) return { mode: "readOnly", allowedTools: [] };
  const record = object(value, "workflow tool policy");
  return {
    mode: requiredString(record.mode, "workflow tool policy.mode") as WorkflowToolPolicyMode,
    allowedTools: record.allowedTools === undefined || record.allowedTools === null ? [] : strings(record.allowedTools, "workflow tool policy.allowedTools")
  };
}

function decodeWorkflowBudget(value: unknown): WorkflowBudget {
  if (value === undefined || value === null) return {};
  const record = object(value, "workflow budget");
  const maxTokens = optionalNumber(record.maxTokens, "workflow budget.maxTokens");
  const maxCostUSD = optionalNumber(record.maxCostUSD, "workflow budget.maxCostUSD");
  const wallClockSeconds = optionalNumber(record.wallClockSeconds, "workflow budget.wallClockSeconds");
  return {
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(maxCostUSD === undefined ? {} : { maxCostUSD }),
    ...(wallClockSeconds === undefined ? {} : { wallClockSeconds })
  };
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value;
}

function metadata(value: unknown, field: string): Record<string, JSONValue> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value as Record<string, JSONValue>;
}

function strings(value: unknown, field: string): string[] {
  return requiredArray(value, field).map((item) => requiredString(item, field));
}

function stringsFromAliases(record: Record<string, unknown>, field: string, ...keys: string[]): string[] {
  const value = first(record, keys);
  return value === undefined || value === null ? [] : strings(value, field);
}

function requiredAlias(record: Record<string, unknown>, field: string, ...keys: string[]): string {
  const value = first(record, keys);
  return requiredString(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : requiredNumber(value, field);
}

function first(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function signalOptions(signal: AbortSignal | undefined): Pick<RequestOptions<unknown>, "signal"> {
  return signal === undefined ? {} : { signal };
}
