import { cursorFeed, type CursorFeed } from "./cursorFeed.ts";
import { encodePathSegment, type Transport } from "./transport.ts";
import { metadata, nonNegativeCursor, object, optionalString, requiredAlias, signalOptions, strings, type DurableRequestOptions } from "./durableSupport.ts";
import { requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.ts";
import type { JSONValue } from "./types/common.ts";
import type { HandoffArtifact, HandoffEvent, HandoffJournalEntry, HandoffPlan, HandoffPlanStep, HandoffRecord, HandoffRequest, HandoffTarget } from "./types/durable.ts";

export interface HandoffListOptions extends DurableRequestOptions { sourceSessionId?: string }
export interface HandoffFeedOptions extends DurableRequestOptions { after?: number; pollIntervalMs?: number }

/** REST and cursor-feed access to durable session handoffs. */
export class HandoffClient {
  constructor(private readonly transport: Transport) {}

  async list(options: HandoffListOptions = {}): Promise<HandoffRecord[]> {
    const query = options.sourceSessionId === undefined ? "" : `?sourceSession=${encodeURIComponent(options.sourceSessionId)}`;
    const value = await this.transport.json<unknown>(`/handoffs${query}`, { ...signalOptions(options.signal) });
    return requiredArray(value, "handoffs").map(decodeHandoffRecord);
  }

  async propose(request: HandoffRequest, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    const value = await this.transport.json<unknown>("/handoff", {
      method: "POST",
      body: encodeHandoffRequest(request),
      expectedStatus: 201,
      ...signalOptions(options.signal)
    });
    return decodeHandoffRecord(value);
  }

  async get(id: string, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    const value = await this.transport.json<unknown>(`/handoff/${encodePathSegment(id)}`, { ...signalOptions(options.signal) });
    return decodeHandoffRecord(value);
  }

  async events(id: string, after = 0, options: DurableRequestOptions = {}): Promise<HandoffEvent[]> {
    const cursor = nonNegativeCursor(after);
    const value = await this.transport.json<unknown>(`/handoff/${encodePathSegment(id)}/events?after=${cursor}`, { ...signalOptions(options.signal) });
    return requiredArray(value, "handoff events").map(decodeHandoffEvent);
  }

  feed(id: string, options: HandoffFeedOptions = {}): CursorFeed<HandoffEvent> {
    return cursorFeed({
      initialCursor: (options.after ?? 0) as number,
      cursorOf: (event) => event.sequence,
      fetchPage: async (cursor, signal) => ({ items: await this.events(id, cursor, { signal }) }),
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
  }

  async accept(id: string, owner: string, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    return this.decision(id, "accept", { owner }, options);
  }

  async complete(id: string, owner: string, target?: HandoffTarget, metadataValue: Record<string, JSONValue> = {}, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    const body = { owner, ...(target === undefined ? {} : { target: encodeHandoffTarget(target) }), metadata: metadataValue };
    return this.transition(id, "complete", body, options);
  }

  async reject(id: string, owner: string, reason?: string, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    return this.decision(id, "reject", { owner, ...(reason === undefined ? {} : { reason }) }, options);
  }

  async cancel(id: string, owner: string, reason?: string, options: DurableRequestOptions = {}): Promise<HandoffRecord> {
    return this.decision(id, "cancel", { owner, ...(reason === undefined ? {} : { reason }) }, options);
  }

  async export(id: string, options: DurableRequestOptions = {}): Promise<HandoffJournalEntry[]> {
    const value = await this.transport.json<unknown>(`/handoff/${encodePathSegment(id)}/export`, { ...signalOptions(options.signal) });
    return requiredArray(value, "handoff export").map(decodeHandoffJournalEntry);
  }

  async exportHandoff(id: string, options: DurableRequestOptions = {}): Promise<HandoffJournalEntry[]> {
    return this.export(id, options);
  }

  private async decision(id: string, action: "accept" | "reject" | "cancel", body: Record<string, unknown>, options: DurableRequestOptions): Promise<HandoffRecord> {
    return this.transition(id, action, body, options);
  }

  private async transition(id: string, action: string, body: Record<string, unknown>, options: DurableRequestOptions): Promise<HandoffRecord> {
    const value = await this.transport.json<unknown>(`/handoff/${encodePathSegment(id)}/${action}`, {
      method: "POST",
      body,
      expectedStatus: 200,
      ...signalOptions(options.signal)
    });
    return decodeHandoffRecord(value);
  }
}

export function encodeHandoffRequest(request: HandoffRequest): Record<string, unknown> {
  return {
    id: request.id,
    sourceSessionID: request.sourceSessionId,
    sourceOwner: request.sourceOwner,
    ...(request.targetOwner === undefined ? {} : { targetOwner: request.targetOwner }),
    kind: request.kind,
    target: encodeHandoffTarget(request.target),
    ...(request.plan === undefined ? {} : { plan: encodeHandoffPlan(request.plan) }),
    artifacts: request.artifacts.map(encodeHandoffArtifact),
    metadata: request.metadata
  };
}

export function encodeHandoffTarget(target: HandoffTarget): Record<string, unknown> {
  return {
    ...(target.sessionId === undefined ? {} : { sessionID: target.sessionId }),
    ...(target.clientId === undefined ? {} : { clientID: target.clientId }),
    ...(target.workspaceId === undefined ? {} : { workspaceID: target.workspaceId }),
    ...(target.backendId === undefined ? {} : { backendID: target.backendId }),
    ...(target.providerId === undefined ? {} : { providerID: target.providerId })
  };
}

function encodeHandoffPlan(plan: HandoffPlan): Record<string, unknown> {
  return {
    summary: plan.summary,
    steps: plan.steps.map((step) => ({ id: step.id, title: step.title, dependsOn: step.dependsOn, completed: step.completed })),
    metadata: plan.metadata
  };
}

function encodeHandoffArtifact(artifact: HandoffArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    kind: artifact.kind,
    reference: artifact.reference,
    sourceSessionID: artifact.sourceSessionId,
    ...(artifact.checksum === undefined ? {} : { checksum: artifact.checksum }),
    metadata: artifact.metadata
  };
}

export function decodeHandoffRecord(value: unknown): HandoffRecord {
  const record = object(value, "handoff record");
  const request = decodeHandoffRequest(record);
  const acceptedAt = optionalString(record.acceptedAt, "handoff.acceptedAt");
  const completedAt = optionalString(record.completedAt, "handoff.completedAt");
  const resolutionMessage = optionalString(record.resolutionMessage, "handoff.resolutionMessage");
  return {
    ...request,
    state: requiredString(record.state, "handoff.state") as HandoffRecord["state"],
    createdAt: requiredString(record.createdAt, "handoff.createdAt"),
    updatedAt: requiredString(record.updatedAt, "handoff.updatedAt"),
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(resolutionMessage === undefined ? {} : { resolutionMessage })
  };
}

export function decodeHandoffRequest(value: unknown): HandoffRequest {
  const record = object(value, "handoff request");
  const targetOwner = optionalString(record.targetOwner, "handoff.targetOwner");
  const plan = record.plan === undefined || record.plan === null ? undefined : decodeHandoffPlan(record.plan);
  return {
    ...record,
    id: requiredString(record.id, "handoff.id"),
    sourceSessionId: requiredAlias(record, "handoff.sourceSessionId", "sourceSessionID", "sourceSessionId"),
    sourceOwner: requiredString(record.sourceOwner, "handoff.sourceOwner"),
    ...(targetOwner === undefined ? {} : { targetOwner }),
    kind: requiredString(record.kind, "handoff.kind") as HandoffRequest["kind"],
    target: decodeHandoffTarget(record.target),
    ...(plan === undefined ? {} : { plan }),
    artifacts: requiredArray(record.artifacts, "handoff.artifacts").map(decodeHandoffArtifact),
    metadata: metadata(record.metadata, "handoff.metadata")
  };
}

export function decodeHandoffTarget(value: unknown): HandoffTarget {
  const record = object(value, "handoff target");
  const sessionId = optionalString(record.sessionID ?? record.sessionId, "handoff target.sessionId");
  const clientId = optionalString(record.clientID ?? record.clientId, "handoff target.clientId");
  const workspaceId = optionalString(record.workspaceID ?? record.workspaceId, "handoff target.workspaceId");
  const backendId = optionalString(record.backendID ?? record.backendId, "handoff target.backendId");
  const providerId = optionalString(record.providerID ?? record.providerId, "handoff target.providerId");
  return {
    ...record,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(backendId === undefined ? {} : { backendId }),
    ...(providerId === undefined ? {} : { providerId })
  };
}

export function decodeHandoffArtifact(value: unknown): HandoffArtifact {
  const record = object(value, "handoff artifact");
  const checksum = optionalString(record.checksum, "handoff artifact.checksum");
  return {
    ...record,
    id: requiredString(record.id, "handoff artifact.id"),
    kind: requiredString(record.kind, "handoff artifact.kind"),
    reference: requiredString(record.reference, "handoff artifact.reference"),
    sourceSessionId: requiredAlias(record, "handoff artifact.sourceSessionId", "sourceSessionID", "sourceSessionId"),
    ...(checksum === undefined ? {} : { checksum }),
    metadata: metadata(record.metadata, "handoff artifact.metadata")
  };
}

export function decodeHandoffPlan(value: unknown): HandoffPlan {
  const record = object(value, "handoff plan");
  return {
    ...record,
    summary: requiredString(record.summary, "handoff plan.summary"),
    steps: requiredArray(record.steps, "handoff plan.steps").map(decodeHandoffPlanStep),
    metadata: metadata(record.metadata, "handoff plan.metadata")
  };
}

export function decodeHandoffPlanStep(value: unknown): HandoffPlanStep {
  const record = object(value, "handoff plan step");
  return {
    ...record,
    id: requiredString(record.id, "handoff plan step.id"),
    title: requiredString(record.title, "handoff plan step.title"),
    dependsOn: strings(record.dependsOn, "handoff plan step.dependsOn"),
    completed: requiredBoolean(record.completed, "handoff plan step.completed")
  };
}

export function decodeHandoffEvent(value: unknown): HandoffEvent {
  const record = object(value, "handoff event");
  const message = optionalString(record.message, "handoff event.message");
  return {
    ...record,
    sequence: requiredNumber(record.sequence, "handoff event.sequence"),
    handoffId: requiredAlias(record, "handoff event.handoffId", "handoffID", "handoffId"),
    sourceSessionId: requiredAlias(record, "handoff event.sourceSessionId", "sourceSessionID", "sourceSessionId"),
    timestamp: requiredString(record.timestamp, "handoff event.timestamp"),
    kind: requiredString(record.kind, "handoff event.kind"),
    state: requiredString(record.state, "handoff event.state") as HandoffEvent["state"],
    ...(message === undefined ? {} : { message }),
    metadata: metadata(record.metadata, "handoff event.metadata")
  };
}

export function decodeHandoffJournalEntry(value: unknown): HandoffJournalEntry {
  const record = object(value, "handoff journal entry");
  return { ...record, event: decodeHandoffEvent(record.event), record: decodeHandoffRecord(record.record) };
}
