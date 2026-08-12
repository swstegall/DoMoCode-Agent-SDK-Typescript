import { Transport, type TransportOptions, encodePathSegment } from "./transport.ts";
import { NotFoundError, SessionAlreadyAcquiredError } from "./types/errors.ts";
import type { ServerCapabilities, SessionRef, SessionSummary } from "./types/sessions.ts";
import type { CatalogSnapshot } from "./types/catalogs.ts";
import { SessionHandle, type SessionAcquireOptions, type SessionAttachOptions } from "./session.ts";
import { isRecord, requiredString } from "./types/common.ts";
import { decodeServerEvent } from "./types/events.ts";
import { CatalogClient, type ModelCatalogOptions } from "./catalogs.ts";
import { WorkflowClient } from "./workflows.ts";
import { JobClient } from "./jobs.ts";
import { HandoffClient } from "./handoffs.ts";
import { AutomationClient } from "./automations.ts";
import { McpClient } from "./mcp.ts";
import { InteractionRuntime, type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";

export interface DoMoCodeClientOptions extends TransportOptions {}
export interface CatalogOptions extends ModelCatalogOptions {
  session?: SessionHandle;
  includeSkillBody?: boolean;
}

export class DoMoCodeClient {
  readonly transport: Transport;
  readonly sessions: SessionRegistry;
  readonly catalogs: CatalogClient;
  readonly workflows: WorkflowClient;
  readonly jobs: JobClient;
  readonly handoffs: HandoffClient;
  readonly automations: AutomationClient;
  readonly mcp: McpClient;
  private clientInteractionRuntime: InteractionRuntime | undefined;

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

  /**
   * Read the global command/skill/agent/model inventory in one call. Tools are
   * session-scoped; pass an already-open handle to include that live view.
   */
  async catalog(options: CatalogOptions = {}): Promise<CatalogSnapshot> {
    const [commands, skills, agents, models] = await Promise.all([
      this.catalogs.commands(),
      this.catalogs.skills(options.includeSkillBody ? { includeBody: true } : {}),
      this.catalogs.agents(),
      this.catalogs.models(options)
    ]);
    const tools = options.session ? await options.session.tools() : [];
    return { tools, commands: commands.commands, skills, agents, models };
  }

  /** Aggregate permission, question, and server-scoped OAuth asks across sessions. */
  interactions(options: InteractionRuntimeOptions = {}): AsyncIterableIterator<RuntimeInteraction> {
    const runtime = this.interactionRuntimeFor(options);
    void this.refreshOAuthPending(runtime);
    return runtime.interactions();
  }

  onInteraction(handler: InteractionHandler, options: InteractionRuntimeOptions = {}): () => void {
    const runtime = this.interactionRuntimeFor(options);
    void this.refreshOAuthPending(runtime);
    return runtime.onInteraction(handler);
  }

  pendingInteractions(options: InteractionRuntimeOptions = {}): RuntimeInteraction[] {
    return this.interactionRuntimeFor(options).pending();
  }

  /** @internal Register an attached session with the client-level dispatcher. */
  registerSession(session: SessionHandle): void {
    if (!this.clientInteractionRuntime || !session.eventsEngine) return;
    void this.clientInteractionRuntime.attach(session).catch(() => undefined);
  }

  private interactionRuntimeFor(options: InteractionRuntimeOptions): InteractionRuntime {
    if (!this.clientInteractionRuntime) {
      this.clientInteractionRuntime = new InteractionRuntime({ ...options, includeOAuth: true });
      for (const session of this.sessions.all()) this.registerSession(session);
    }
    return this.clientInteractionRuntime;
  }

  private async refreshOAuthPending(runtime: InteractionRuntime): Promise<void> {
    try {
      const value = await this.transport.json<unknown>("/oauth/pending");
      if (!Array.isArray(value)) return;
      for (const item of value) {
        const event = decodeServerEvent(item);
        if (event.type === "oauth_request" && "authorizationUrl" in event) runtime.acceptOAuth(event);
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) return;
    }
  }

  async capabilities(): Promise<ServerCapabilities | undefined> {
    try {
      const value = await this.transport.json<unknown>("/capabilities");
      if (!isRecord(value)) throw new TypeError("Capabilities response must be an object");
      return { name: requiredString(value.name, "capabilities.name"), version: requiredString(value.version, "capabilities.version"), protocolVersion: typeof value.protocolVersion === "number" ? value.protocolVersion : 1, capabilities: Array.isArray(value.capabilities) ? value.capabilities.map((item) => requiredString(item, "capability")) : [] };
    } catch (error) {
      if (error instanceof NotFoundError) return;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.clientInteractionRuntime?.close();
    this.clientInteractionRuntime = undefined;
    await this.sessions.close();
  }
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

  all(): SessionHandle[] { return [...this.handles.values()]; }

  releaseLease(id: string): void { this.exclusiveLeases.delete(id); }

  private async openRef(ref: SessionRef, options: SessionAttachOptions): Promise<SessionHandle> {
    const handle = this.getOrCreate(ref);
    await handle.attach(options);
    this.client.registerSession(handle);
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
