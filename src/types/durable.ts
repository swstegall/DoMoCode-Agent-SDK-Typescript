import type { JSONValue, OpenEnum } from "./common.ts";

export interface CursorEvent {
  sequence: number;
  timestamp?: string;
  kind: string;
  [key: string]: unknown;
}

export type WorkflowStageKind = OpenEnum<"ask" | "debug" | "review" | "research" | "plan" | "execute" | "synthesize">;
export type WorkflowToolPolicyMode = OpenEnum<"readOnly" | "approvedMutations" | "full">;
export type WorkflowApprovalBoundary = OpenEnum<"none" | "beforeStage" | "beforeMutation" | "beforeSynthesis">;
export type WorkflowCancellationPolicy = OpenEnum<"stopDependents" | "continueIndependent" | "checkpointAndStop">;
export type WorkflowExecutionMode = OpenEnum<"serial" | "parallel">;
export type WorkflowRunStatus = OpenEnum<"pending" | "running" | "paused" | "succeeded" | "failed" | "cancelled">;
export type WorkflowStageRunStatus = OpenEnum<"pending" | "ready" | "waitingForApproval" | "running" | "succeeded" | "failed" | "cancelled" | "skipped">;

export interface WorkflowToolPolicy {
  mode: WorkflowToolPolicyMode;
  allowedTools: string[];
}

export interface WorkflowBudget {
  maxTokens?: number;
  maxCostUSD?: number;
  wallClockSeconds?: number;
}

export interface WorkflowStageDefinition {
  id: string;
  displayName: string;
  kind: WorkflowStageKind;
  dependencies: string[];
  toolPolicy: WorkflowToolPolicy;
  model?: string;
  profile?: string;
  contextInputs: string[];
  outputArtifact?: string;
  budget: WorkflowBudget;
  timeoutSeconds?: number;
  cancellationPolicy: WorkflowCancellationPolicy;
  approvalBoundary: WorkflowApprovalBoundary;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  id: string;
  displayName: string;
  version: number;
  executionMode: WorkflowExecutionMode;
  stages: WorkflowStageDefinition[];
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface WorkflowEvidence {
  id: string;
  stageId: string;
  source: string;
  sessionId?: string;
  kind: OpenEnum<"observed" | "inference">;
  untrustedData: boolean;
  summary: string;
  locator?: string;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface WorkflowStageRunRecord {
  stageId: string;
  status: WorkflowStageRunStatus;
  startedAt?: string;
  finishedAt?: string;
  output: JSONValue;
  error?: string;
  agentIds: string[];
  evidence: WorkflowEvidence[];
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
  input: JSONValue;
  stages: WorkflowStageRunRecord[];
  output: JSONValue;
  error?: string;
  cancellationRequested: boolean;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface WorkflowApprovalRequest {
  workflowId: string;
  runId: string;
  stage: WorkflowStageDefinition;
  [key: string]: unknown;
}

export type WorkflowApproval = WorkflowApprovalRequest;

export type WorkflowStoreRecordKind = OpenEnum<"definition" | "runSnapshot">;
export interface WorkflowStoreRecord {
  kind: WorkflowStoreRecordKind;
  id: string;
  timestamp: string;
  definition?: WorkflowDefinition;
  run?: WorkflowRunRecord;
  [key: string]: unknown;
}

export type HandoffKind = OpenEnum<"attach" | "continueSession" | "transfer">;
export type HandoffState = OpenEnum<"proposed" | "accepted" | "completed" | "rejected" | "cancelled">;

export interface HandoffTarget {
  sessionId?: string;
  clientId?: string;
  workspaceId?: string;
  backendId?: string;
  providerId?: string;
  [key: string]: unknown;
}

export interface HandoffArtifact {
  id: string;
  kind: string;
  reference: string;
  sourceSessionId: string;
  checksum?: string;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface HandoffPlanStep {
  id: string;
  title: string;
  dependsOn: string[];
  completed: boolean;
  [key: string]: unknown;
}

export interface HandoffPlan {
  summary: string;
  steps: HandoffPlanStep[];
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface HandoffRequest {
  id: string;
  sourceSessionId: string;
  sourceOwner: string;
  targetOwner?: string;
  kind: HandoffKind;
  target: HandoffTarget;
  plan?: HandoffPlan;
  artifacts: HandoffArtifact[];
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface HandoffRecord extends HandoffRequest {
  state: HandoffState;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  completedAt?: string;
  resolutionMessage?: string;
}

export interface HandoffEvent extends CursorEvent {
  handoffId: string;
  sourceSessionId: string;
  state: HandoffState;
  message?: string;
  metadata: Record<string, JSONValue>;
}

export interface HandoffJournalEntry {
  event: HandoffEvent;
  record: HandoffRecord;
  [key: string]: unknown;
}

export type SessionHandoffKind = HandoffKind;
export type SessionHandoffState = HandoffState;
export type SessionHandoffTarget = HandoffTarget;
export type SessionHandoffArtifact = HandoffArtifact;
export type SessionHandoffPlanStep = HandoffPlanStep;
export type SessionHandoffPlan = HandoffPlan;
export type SessionHandoffRequest = HandoffRequest;
export type SessionHandoffRecord = HandoffRecord;
export type SessionHandoffEvent = HandoffEvent;
export type SessionHandoffJournalEntry = HandoffJournalEntry;

export type JobState = OpenEnum<"queued" | "running" | "retrying" | "paused" | "succeeded" | "failed" | "cancelled">;
export type JobTriggerSource = OpenEnum<"userPrompt" | "cli" | "scheduled" | "filesystem" | "repository" | "webhook" | "childAgentResult" | "systemRecovery" | "unknown">;

export interface JobProgress {
  fraction: number;
  message?: string;
}

export interface JobRetryPolicy {
  maxAttempts: number;
  initialBackoffMilliseconds: number;
  maximumBackoffMilliseconds: number;
}

export interface JobRecord {
  id: string;
  correlationId: string;
  sessionId?: string;
  taskId?: string;
  parentJobId?: string;
  kind: string;
  owner: string;
  retryPolicy: JobRetryPolicy;
  state: JobState;
  progress: JobProgress;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  output?: JSONValue;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface JobEvent extends CursorEvent {
  jobId: string;
  correlationId: string;
  state: JobState;
  attempt: number;
  progress: JobProgress;
  message?: string;
  metadata: Record<string, JSONValue>;
}

export interface JobJournalEntry {
  event: JobEvent;
  record: JobRecord;
  [key: string]: unknown;
}

export type AutomationTriggerKind = OpenEnum<"manual" | "cli" | "schedule" | "filesystem" | "repository" | "webhook">;
export type AutomationInvocationSource = OpenEnum<"userPrompt" | "cli" | "scheduledTrigger" | "filesystemTrigger" | "repositoryTrigger" | "authenticatedWebhook" | "childAgentResult">;
export type AutomationCancellationPolicy = OpenEnum<"cooperative" | "deadline" | "parentCancellation">;

export interface AutomationBudget {
  maxRuntimeMilliseconds: number;
  maxAttempts: number;
  maxOutputBytes: number;
  maxCostMicros?: number;
}

export interface AutomationSecretScope {
  credentialReferences: string[];
  environmentNames: string[];
  allowInheritedEnvironment: boolean;
}

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  expression?: string;
  path?: string;
  branch?: string;
  webhookId?: string;
  authenticated: boolean;
}

export interface AutomationDefinition {
  id: string;
  displayName: string;
  owner: string;
  profileId: string;
  workspaceRoot: string;
  sandboxPolicyId: string;
  backendId?: string;
  providerId?: string;
  trigger: AutomationTrigger;
  budget: AutomationBudget;
  secretScope: AutomationSecretScope;
  cancellationPolicy: AutomationCancellationPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface AutomationInvocation {
  id: string;
  automationId: string;
  source: AutomationInvocationSource;
  requestedBy: string;
  sessionId?: string;
  jobId?: string;
  createdAt: string;
  input: JSONValue;
  metadata: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface AutomationEvent extends CursorEvent {
  automationId: string;
  enabled: boolean;
  invocationId?: string;
  message?: string;
  metadata: Record<string, JSONValue>;
}

export type AutomationAuditEvent = AutomationEvent;

export interface AutomationJournalEntry {
  event: AutomationEvent;
  definition: AutomationDefinition;
  invocation?: AutomationInvocation;
  [key: string]: unknown;
}
