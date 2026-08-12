import { Transport, type TransportOptions, encodePathSegment } from "./transport.ts";
import { NotFoundError, SessionAlreadyAcquiredError } from "./types/errors.ts";
import type { ServerCapabilities, SessionRef, SessionSummary } from "./types/sessions.ts";
import { SessionHandle, type SessionAcquireOptions, type SessionAttachOptions } from "./session.ts";
import { isRecord, requiredString } from "./types/common.ts";
import { CatalogClient } from "./catalogs.ts";
import { WorkflowClient } from "./workflows.ts";
import { JobClient } from "./jobs.ts";
import { HandoffClient } from "./handoffs.ts";
import { AutomationClient } from "./automations.ts";
import { McpClient } from "./mcp.ts";

export interface DoMoCodeClientOptions extends TransportOptions {}

export class DoMoCodeClient {
  readonly transport: Transport;
  readonly sessions: SessionRegistry;
  readonly catalogs: CatalogClient;
  readonly workflows: WorkflowClient;
  readonly jobs: JobClient;
  readonly handoffs: HandoffClient;
  readonly automations: AutomationClient;
  readonly mcp: McpClient;

  constructor(options: DoMoCodeClientOptions) {
    this.transport = new Transport(options);
    this.sessions = new SessionRegistry(this);
    this.catalogs = new CatalogClient(this.transport);
    this.workflows = new WorkflowClient(this.transport);
    this.jobs = new JobClient(this.transport);
    this.handoffs = new HandoffClient(this.transport);
    this.automations = new AutomationClient(this.transport);
    this.mcp = new McpClient(this.transport);
  }

  get baseURL(): string { return this.transport.baseURL; }
  get clientId(): string { return this.transport.clientId; }
  get owner(): string { return this.transport.owner; }

  async capabilities(): Promise<ServerCapabilities | undefined> {
    try {
      const value = await this.transport.json<unknown>("/capabilities");
      if (!isRecord(value)) throw new TypeError("Capabilities response must be an object");
      return { name: requiredString(value.name, "capabilities.name"), version: requiredString(value.version, "capabilities.version"), protocolVersion: typeof value.protocolVersion === "number" ? value.protocolVersion : 1, capabilities: Array.isArray(value.capabilities) ? value.capabilities.map((item) => requiredString(item, "capability")) : [] };
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  }

  async close(): Promise<void> { await this.sessions.close(); }
}

export class SessionRegistry {
  private readonly handles = new Map<string, SessionHandle>();
  private readonly exclusiveLeases = new Set<string>();

  constructor(private readonly client: DoMoCodeClient) {}

  async list(): Promise<SessionSummary[]> {
    const value = await this.client.transport.json<unknown>("/sessions");
    if (!Array.isArray(value)) throw new TypeError("Session list must be an array");
    return value.map(decodeSessionSummary);
  }

  async create(options: SessionAttachOptions = {}): Promise<SessionHandle> {
    const value = await this.client.transport.json<unknown>("/session", { method: "POST", body: {} });
    const ref = decodeSessionRef(value);
    return this.openRef(ref, options);
  }

  async resume(id: string, options: SessionAttachOptions = {}): Promise<SessionHandle> {
    const value = await this.client.transport.json<unknown>("/session", { method: "POST", body: { resume: id } });
    const ref = decodeSessionRef(value);
    return this.openRef(ref, options);
  }

  async open(id: string, options: SessionAttachOptions = {}): Promise<SessionHandle> {
    const existing = this.handles.get(id);
    if (existing) {
      await existing.attach(options);
      return existing;
    }
    return this.resume(id, options);
  }

  async acquire(id: string, options: SessionAcquireOptions = {}): Promise<SessionHandle> {
    const mode = options.mode ?? "exclusive";
    if (mode === "exclusive" && this.exclusiveLeases.has(id)) throw new SessionAlreadyAcquiredError(id);
    const handle = await this.open(id, options);
    if (mode === "exclusive") this.exclusiveLeases.add(id);
    handle.setLease(mode, () => { if (mode === "exclusive") this.exclusiveLeases.delete(id); });
    return handle;
  }

  forget(id: string): void { this.handles.delete(id); this.exclusiveLeases.delete(id); }

  async close(): Promise<void> {
    const handles = [...this.handles.values()];
    for (const handle of handles) await handle.dispose();
    this.handles.clear();
    this.exclusiveLeases.clear();
  }

  getOrCreate(ref: SessionRef): SessionHandle {
    const existing = this.handles.get(ref.id);
    if (existing) return existing;
    const handle = new SessionHandle(this.client, ref, () => this.forget(ref.id));
    this.handles.set(ref.id, handle);
    return handle;
  }

  releaseLease(id: string): void { this.exclusiveLeases.delete(id); }

  private async openRef(ref: SessionRef, options: SessionAttachOptions): Promise<SessionHandle> {
    const handle = this.getOrCreate(ref);
    await handle.attach(options);
    return handle;
  }
}

export function decodeSessionRef(value: unknown): SessionRef {
  if (!isRecord(value)) throw new TypeError("Session reference must be an object");
  return { id: requiredString(value.id, "session.id"), path: requiredString(value.path, "session.path") };
}

export function decodeSessionSummary(value: unknown): SessionSummary {
  if (!isRecord(value)) throw new TypeError("Session summary must be an object");
  return { id: requiredString(value.id, "session.id"), path: requiredString(value.path, "session.path"), cwd: requiredString(value.cwd, "session.cwd"), timestamp: requiredString(value.timestamp, "session.timestamp"), ...(value.name === undefined || value.name === null ? {} : { name: requiredString(value.name, "session.name") }), ...(value.parentSession === undefined || value.parentSession === null ? {} : { parentSession: requiredString(value.parentSession, "session.parentSession") }) };
}

export function sessionPath(id: string, suffix = ""): string {
  return `/session/${encodePathSegment(id)}${suffix}`;
}
