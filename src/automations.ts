import { cursorFeed, type CursorFeed } from "./cursorFeed.ts";
import { encodePathSegment, type Transport } from "./transport.ts";
import { metadata, nonNegativeCursor, object, optionalNumber, optionalString, requiredAlias, signalOptions, strings, type DurableRequestOptions } from "./durableSupport.ts";
import { requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.ts";
import type { JSONValue } from "./types/common.ts";
import type { AutomationAuditEvent, AutomationBudget, AutomationDefinition, AutomationEvent, AutomationInvocation, AutomationJournalEntry, AutomationSecretScope, AutomationTrigger } from "./types/durable.ts";

export interface AutomationListOptions extends DurableRequestOptions { owner?: string }
export interface AutomationFeedOptions extends DurableRequestOptions { after?: number; pollIntervalMs?: number }

/** REST and cursor-feed access to the policy and audit side of automations. */
export class AutomationClient {
  constructor(private readonly transport: Transport) {}

  async list(options: AutomationListOptions = {}): Promise<AutomationDefinition[]> {
    const query = options.owner === undefined ? "" : `?owner=${encodeURIComponent(options.owner)}`;
    const value = await this.transport.json<unknown>(`/automations${query}`, { ...signalOptions(options.signal) });
    return requiredArray(value, "automations").map(decodeAutomationDefinition);
  }

  async register(definition: AutomationDefinition, options: DurableRequestOptions = {}): Promise<AutomationDefinition> {
    const value = await this.transport.json<unknown>("/automation", {
      method: "POST",
      body: encodeAutomationDefinition(definition),
      expectedStatus: 201,
      ...signalOptions(options.signal)
    });
    return decodeAutomationDefinition(value);
  }

  async get(id: string, options: DurableRequestOptions = {}): Promise<AutomationDefinition> {
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(id)}`, { ...signalOptions(options.signal) });
    return decodeAutomationDefinition(value);
  }

  async enable(id: string, owner: string, options: DurableRequestOptions = {}): Promise<AutomationDefinition> {
    return this.setEnabled(id, owner, true, options);
  }

  async disable(id: string, owner: string, options: DurableRequestOptions = {}): Promise<AutomationDefinition> {
    return this.setEnabled(id, owner, false, options);
  }

  async setEnabled(id: string, owner: string, enabled: boolean, options: DurableRequestOptions = {}): Promise<AutomationDefinition> {
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(id)}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
      body: { owner },
      expectedStatus: 200,
      ...signalOptions(options.signal)
    });
    return decodeAutomationDefinition(value);
  }

  async invoke(invocation: AutomationInvocation, options: DurableRequestOptions = {}): Promise<AutomationInvocation> {
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(invocation.automationId)}/invoke`, {
      method: "POST",
      body: encodeAutomationInvocation(invocation),
      expectedStatus: 202,
      ...signalOptions(options.signal)
    });
    return decodeAutomationInvocation(value);
  }

  async events(id: string, after = 0, options: DurableRequestOptions = {}): Promise<AutomationEvent[]> {
    const cursor = nonNegativeCursor(after);
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(id)}/events?after=${cursor}`, { ...signalOptions(options.signal) });
    return requiredArray(value, "automation events").map(decodeAutomationEvent);
  }

  feed(id: string, options: AutomationFeedOptions = {}): CursorFeed<AutomationEvent> {
    return cursorFeed({
      initialCursor: (options.after ?? 0) as number,
      cursorOf: (event) => event.sequence,
      fetchPage: async (cursor, signal) => ({ items: await this.events(id, cursor, { signal }) }),
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
  }

  async invocations(id: string, options: DurableRequestOptions = {}): Promise<AutomationInvocation[]> {
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(id)}/invocations`, { ...signalOptions(options.signal) });
    return requiredArray(value, "automation invocations").map(decodeAutomationInvocation);
  }

  async export(id: string, options: DurableRequestOptions = {}): Promise<AutomationJournalEntry[]> {
    const value = await this.transport.json<unknown>(`/automation/${encodePathSegment(id)}/export`, { ...signalOptions(options.signal) });
    return requiredArray(value, "automation export").map(decodeAutomationJournalEntry);
  }

  async exportAutomation(id: string, options: DurableRequestOptions = {}): Promise<AutomationJournalEntry[]> {
    return this.export(id, options);
  }
}

export function encodeAutomationDefinition(definition: AutomationDefinition): Record<string, unknown> {
  return {
    id: definition.id,
    displayName: definition.displayName,
    owner: definition.owner,
    profileID: definition.profileId,
    workspaceRoot: definition.workspaceRoot,
    sandboxPolicyID: definition.sandboxPolicyId,
    ...(definition.backendId === undefined ? {} : { backendID: definition.backendId }),
    ...(definition.providerId === undefined ? {} : { providerID: definition.providerId }),
    trigger: encodeAutomationTrigger(definition.trigger),
    budget: encodeAutomationBudget(definition.budget),
    secretScope: encodeAutomationSecretScope(definition.secretScope),
    cancellationPolicy: definition.cancellationPolicy,
    enabled: definition.enabled,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    metadata: definition.metadata
  };
}

export function encodeAutomationInvocation(invocation: AutomationInvocation): Record<string, unknown> {
  return {
    id: invocation.id,
    automationID: invocation.automationId,
    source: invocation.source,
    requestedBy: invocation.requestedBy,
    ...(invocation.sessionId === undefined ? {} : { sessionID: invocation.sessionId }),
    ...(invocation.jobId === undefined ? {} : { jobID: invocation.jobId }),
    createdAt: invocation.createdAt,
    input: invocation.input,
    metadata: invocation.metadata
  };
}

function encodeAutomationTrigger(trigger: AutomationTrigger): Record<string, unknown> {
  return {
    kind: trigger.kind,
    ...(trigger.expression === undefined ? {} : { expression: trigger.expression }),
    ...(trigger.path === undefined ? {} : { path: trigger.path }),
    ...(trigger.branch === undefined ? {} : { branch: trigger.branch }),
    ...(trigger.webhookId === undefined ? {} : { webhookID: trigger.webhookId }),
    authenticated: trigger.authenticated
  };
}

function encodeAutomationBudget(budget: AutomationBudget): Record<string, unknown> {
  return {
    maxRuntimeMilliseconds: budget.maxRuntimeMilliseconds,
    maxAttempts: budget.maxAttempts,
    maxOutputBytes: budget.maxOutputBytes,
    ...(budget.maxCostMicros === undefined ? {} : { maxCostMicros: budget.maxCostMicros })
  };
}

function encodeAutomationSecretScope(scope: AutomationSecretScope): Record<string, unknown> {
  return {
    credentialReferences: scope.credentialReferences,
    environmentNames: scope.environmentNames,
    allowInheritedEnvironment: scope.allowInheritedEnvironment
  };
}

export function decodeAutomationDefinition(value: unknown): AutomationDefinition {
  const record = object(value, "automation definition");
  const backendId = optionalString(record.backendID ?? record.backendId, "automation.backendId");
  const providerId = optionalString(record.providerID ?? record.providerId, "automation.providerId");
  return {
    ...record,
    id: requiredString(record.id, "automation.id"),
    displayName: requiredString(record.displayName, "automation.displayName"),
    owner: requiredString(record.owner, "automation.owner"),
    profileId: requiredAlias(record, "automation.profileId", "profileID", "profileId"),
    workspaceRoot: requiredString(record.workspaceRoot, "automation.workspaceRoot"),
    sandboxPolicyId: requiredAlias(record, "automation.sandboxPolicyId", "sandboxPolicyID", "sandboxPolicyId"),
    ...(backendId === undefined ? {} : { backendId }),
    ...(providerId === undefined ? {} : { providerId }),
    trigger: decodeAutomationTrigger(record.trigger),
    budget: decodeAutomationBudget(record.budget),
    secretScope: decodeAutomationSecretScope(record.secretScope),
    cancellationPolicy: requiredString(record.cancellationPolicy, "automation.cancellationPolicy") as AutomationDefinition["cancellationPolicy"],
    enabled: requiredBoolean(record.enabled, "automation.enabled"),
    createdAt: requiredString(record.createdAt, "automation.createdAt"),
    updatedAt: requiredString(record.updatedAt, "automation.updatedAt"),
    metadata: metadata(record.metadata, "automation.metadata")
  };
}

export function decodeAutomationInvocation(value: unknown): AutomationInvocation {
  const record = object(value, "automation invocation");
  const sessionId = optionalString(record.sessionID ?? record.sessionId, "automation invocation.sessionId");
  const jobId = optionalString(record.jobID ?? record.jobId, "automation invocation.jobId");
  return {
    ...record,
    id: requiredString(record.id, "automation invocation.id"),
    automationId: requiredAlias(record, "automation invocation.automationId", "automationID", "automationId"),
    source: requiredString(record.source, "automation invocation.source") as AutomationInvocation["source"],
    requestedBy: requiredString(record.requestedBy, "automation invocation.requestedBy"),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(jobId === undefined ? {} : { jobId }),
    createdAt: requiredString(record.createdAt, "automation invocation.createdAt"),
    input: (record.input ?? null) as JSONValue,
    metadata: metadata(record.metadata, "automation invocation.metadata")
  };
}

export function decodeAutomationEvent(value: unknown): AutomationEvent {
  const record = object(value, "automation event");
  const invocationId = optionalString(record.invocationID ?? record.invocationId, "automation event.invocationId");
  const message = optionalString(record.message, "automation event.message");
  return {
    ...record,
    sequence: requiredNumber(record.sequence, "automation event.sequence"),
    automationId: requiredAlias(record, "automation event.automationId", "automationID", "automationId"),
    timestamp: requiredString(record.timestamp, "automation event.timestamp"),
    kind: requiredString(record.kind, "automation event.kind"),
    enabled: requiredBoolean(record.enabled, "automation event.enabled"),
    ...(invocationId === undefined ? {} : { invocationId }),
    ...(message === undefined ? {} : { message }),
    metadata: metadata(record.metadata, "automation event.metadata")
  };
}

export function decodeAutomationAuditEvent(value: unknown): AutomationAuditEvent {
  return decodeAutomationEvent(value);
}

export function decodeAutomationJournalEntry(value: unknown): AutomationJournalEntry {
  const record = object(value, "automation journal entry");
  return {
    ...record,
    event: decodeAutomationEvent(record.event),
    definition: decodeAutomationDefinition(record.definition),
    ...(record.invocation === undefined || record.invocation === null ? {} : { invocation: decodeAutomationInvocation(record.invocation) })
  };
}

function decodeAutomationTrigger(value: unknown): AutomationTrigger {
  const record = object(value, "automation trigger");
  const expression = optionalString(record.expression, "automation trigger.expression");
  const path = optionalString(record.path, "automation trigger.path");
  const branch = optionalString(record.branch, "automation trigger.branch");
  const webhookId = optionalString(record.webhookID ?? record.webhookId, "automation trigger.webhookId");
  return {
    ...record,
    kind: requiredString(record.kind, "automation trigger.kind") as AutomationTrigger["kind"],
    ...(expression === undefined ? {} : { expression }),
    ...(path === undefined ? {} : { path }),
    ...(branch === undefined ? {} : { branch }),
    ...(webhookId === undefined ? {} : { webhookId }),
    authenticated: requiredBoolean(record.authenticated, "automation trigger.authenticated")
  };
}

function decodeAutomationBudget(value: unknown): AutomationBudget {
  const record = object(value, "automation budget");
  const maxCostMicros = optionalNumber(record.maxCostMicros, "automation budget.maxCostMicros");
  return {
    maxRuntimeMilliseconds: requiredNumber(record.maxRuntimeMilliseconds, "automation budget.maxRuntimeMilliseconds"),
    maxAttempts: requiredNumber(record.maxAttempts, "automation budget.maxAttempts"),
    maxOutputBytes: requiredNumber(record.maxOutputBytes, "automation budget.maxOutputBytes"),
    ...(maxCostMicros === undefined ? {} : { maxCostMicros })
  };
}

function decodeAutomationSecretScope(value: unknown): AutomationSecretScope {
  const record = object(value, "automation secret scope");
  return {
    credentialReferences: strings(record.credentialReferences, "automation secret scope.credentialReferences"),
    environmentNames: strings(record.environmentNames, "automation secret scope.environmentNames"),
    allowInheritedEnvironment: requiredBoolean(record.allowInheritedEnvironment, "automation secret scope.allowInheritedEnvironment")
  };
}
