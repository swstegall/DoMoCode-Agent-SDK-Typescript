import { cursorFeed, type CursorFeed } from "./cursorFeed.ts";
import { encodePathSegment, type Transport } from "./transport.ts";
import { metadata, nonNegativeCursor, object, optionalString, requiredAlias, signalOptions, type DurableRequestOptions } from "./durableSupport.ts";
import { requiredArray, requiredNumber, requiredString } from "./types/common.ts";
import type { JobEvent, JobJournalEntry, JobProgress, JobRecord, JobRetryPolicy } from "./types/durable.ts";
import type { JSONValue } from "./types/common.ts";

export interface JobListOptions extends DurableRequestOptions { owner?: string }
export interface JobFeedOptions extends DurableRequestOptions { after?: number; pollIntervalMs?: number }

/** REST and cursor-feed access to DoMoCode's durable job manager. */
export class JobClient {
  constructor(private readonly transport: Transport) {}

  async list(options: JobListOptions = {}): Promise<JobRecord[]> {
    const query = options.owner === undefined ? "" : `?owner=${encodeURIComponent(options.owner)}`;
    const value = await this.transport.json<unknown>(`/jobs${query}`, { ...signalOptions(options.signal) });
    return requiredArray(value, "jobs").map(decodeJobRecord);
  }

  async get(id: string, options: DurableRequestOptions = {}): Promise<JobRecord> {
    const value = await this.transport.json<unknown>(`/job/${encodePathSegment(id)}`, { ...signalOptions(options.signal) });
    return decodeJobRecord(value);
  }

  async events(id: string, after = 0, options: DurableRequestOptions = {}): Promise<JobEvent[]> {
    const cursor = nonNegativeCursor(after);
    const path = `/job/${encodePathSegment(id)}/events?after=${cursor}`;
    const value = await this.transport.json<unknown>(path, { ...signalOptions(options.signal) });
    return requiredArray(value, "job events").map(decodeJobEvent);
  }

  feed(id: string, options: JobFeedOptions = {}): CursorFeed<JobEvent> {
    return cursorFeed({
      initialCursor: (options.after ?? 0) as number,
      cursorOf: (event) => event.sequence,
      fetchPage: async (cursor, signal) => ({ items: await this.events(id, cursor, { signal }) }),
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
  }

  async cancel(id: string, owner: string, options: DurableRequestOptions = {}): Promise<JobRecord> {
    const value = await this.transport.json<unknown>(`/job/${encodePathSegment(id)}/cancel`, {
      method: "POST",
      body: { owner },
      expectedStatus: 200,
      ...signalOptions(options.signal)
    });
    return decodeJobRecord(value);
  }

  async recover(options: DurableRequestOptions = {}): Promise<JobRecord[]> {
    const value = await this.transport.json<unknown>("/jobs/recover", {
      method: "POST",
      expectedStatus: 200,
      ...signalOptions(options.signal)
    });
    return requiredArray(value, "recovered jobs").map(decodeJobRecord);
  }

  async export(id: string, options: DurableRequestOptions = {}): Promise<JobJournalEntry[]> {
    const value = await this.transport.json<unknown>(`/job/${encodePathSegment(id)}/export`, { ...signalOptions(options.signal) });
    return requiredArray(value, "job export").map(decodeJobJournalEntry);
  }

  async exportJob(id: string, options: DurableRequestOptions = {}): Promise<JobJournalEntry[]> {
    return this.export(id, options);
  }
}

export function decodeJobRecord(value: unknown): JobRecord {
  const record = object(value, "job record");
  const sessionId = optionalString(record.sessionID ?? record.sessionId, "job.sessionId");
  const taskId = optionalString(record.taskID ?? record.taskId, "job.taskId");
  const parentJobId = optionalString(record.parentJobID ?? record.parentJobId, "job.parentJobId");
  const startedAt = optionalString(record.startedAt, "job.startedAt");
  const finishedAt = optionalString(record.finishedAt, "job.finishedAt");
  const error = optionalString(record.error, "job.error");
  return {
    ...record,
    id: requiredString(record.id, "job.id"),
    correlationId: requiredAlias(record, "job.correlationId", "correlationID", "correlationId"),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(parentJobId === undefined ? {} : { parentJobId }),
    kind: requiredString(record.kind, "job.kind"),
    owner: requiredString(record.owner, "job.owner"),
    retryPolicy: decodeJobRetryPolicy(record.retryPolicy),
    state: requiredString(record.state, "job.state") as JobRecord["state"],
    progress: decodeJobProgress(record.progress),
    attempt: requiredNumber(record.attempt, "job.attempt"),
    createdAt: requiredString(record.createdAt, "job.createdAt"),
    updatedAt: requiredString(record.updatedAt, "job.updatedAt"),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(error === undefined ? {} : { error }),
    ...(record.output === undefined || record.output === null ? {} : { output: record.output as JSONValue }),
    metadata: metadata(record.metadata, "job.metadata")
  };
}

export function decodeJobEvent(value: unknown): JobEvent {
  const record = object(value, "job event");
  const message = optionalString(record.message, "job event.message");
  const timestamp = requiredString(record.timestamp, "job event.timestamp");
  return {
    ...record,
    sequence: requiredNumber(record.sequence, "job event.sequence"),
    timestamp,
    kind: requiredString(record.kind, "job event.kind"),
    jobId: requiredAlias(record, "job event.jobId", "jobID", "jobId"),
    correlationId: requiredAlias(record, "job event.correlationId", "correlationID", "correlationId"),
    state: requiredString(record.state, "job event.state") as JobEvent["state"],
    attempt: requiredNumber(record.attempt, "job event.attempt"),
    progress: decodeJobProgress(record.progress),
    ...(message === undefined ? {} : { message }),
    metadata: metadata(record.metadata, "job event.metadata")
  };
}

export function decodeJobJournalEntry(value: unknown): JobJournalEntry {
  const record = object(value, "job journal entry");
  return { ...record, event: decodeJobEvent(record.event), record: decodeJobRecord(record.record) };
}

function decodeJobProgress(value: unknown): JobProgress {
  const record = object(value, "job progress");
  const message = optionalString(record.message, "job progress.message");
  return { fraction: requiredNumber(record.fraction, "job progress.fraction"), ...(message === undefined ? {} : { message }) };
}

function decodeJobRetryPolicy(value: unknown): JobRetryPolicy {
  const record = object(value, "job retry policy");
  return {
    maxAttempts: requiredNumber(record.maxAttempts, "job retryPolicy.maxAttempts"),
    initialBackoffMilliseconds: requiredNumber(record.initialBackoffMilliseconds, "job retryPolicy.initialBackoffMilliseconds"),
    maximumBackoffMilliseconds: requiredNumber(record.maximumBackoffMilliseconds, "job retryPolicy.maximumBackoffMilliseconds")
  };
}
