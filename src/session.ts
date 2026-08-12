import { EventEngine, type EventListener } from "./eventEngine.ts";
import { Transport, encodePathSegment } from "./transport.ts";
import { decodeMessage, type ImageBlock, type Message } from "./types/messages.ts";
import { decodeServerEvent, type ServerEvent } from "./types/events.ts";
import type { QuestionAnswer } from "./types/asks.ts";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString, type JSONValue } from "./types/common.ts";
import type { AbortResult, ContextSnapshot, DirectToolResult, ForceClearResult, GitDiff, RunResult, ServerCapabilities, SessionAccounting, SessionClientAttachment, SessionClientEvent, SessionClientJournalEntry, SessionRef, SessionStatus, SessionSummary, SessionTreeEntry, WorkspaceHistoryResult, WorkspaceSnapshotStatus } from "./types/sessions.ts";
import { asDecimalString } from "./types/decimal.ts";
import { AttachRejectedError, AuthorityUnavailableError, ConflictError, DoMoError, NotFoundError, RunStalledError, RunStateRaceError, SessionAlreadyAcquiredError, SessionBusyError } from "./types/errors.ts";
import type { DoMoCodeClient } from "./client.ts";
import { InteractionRuntime, type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
import { decodeToolCatalog, filterToolCatalog } from "./catalogs.ts";
import type { ToolCatalogEntry, ToolCatalogFilter } from "./types/catalogs.ts";
import { renderTranscript, type TranscriptOptions } from "./transcript.ts";
import { SubagentRegistry, type SubagentRegistryOptions } from "./subagents.ts";

export type AuthorityPreference = "require" | "prefer" | "observer";
export interface SessionAttachOptions { authority?: AuthorityPreference }
export interface SessionAcquireOptions extends SessionAttachOptions { mode?: "exclusive" | "shared" }
export interface PromptOptions { images?: ImageBlock[] }
export interface SendOptions extends PromptOptions { preferSteer?: boolean }
export interface SettleOptions { maxIdleMs?: number }
export interface SettleResult { stopReason: string; status: SessionStatus }
export interface TaskOptions { taskId?: string; agent?: string; background?: boolean; model?: string }
export type McpResourceAction = "list" | "templates" | "read" | "health";
export interface McpResourceOptions { server?: string; uri?: string }

export class SessionHandle {
  readonly client: DoMoCodeClient;
  private ref: SessionRef;
  private readonly forget: () => void;
  private attachment: SessionClientAttachment | undefined;
  private engine: EventEngine | undefined;
  private disposed = false;
  private runLock = false;
  private leaseRelease: (() => void) | undefined;
  private leaseMode: "exclusive" | "shared" | undefined;
  private cursor = 0;
  private interactionRuntime: InteractionRuntime | undefined;
  private subagentRegistry: SubagentRegistry | undefined;

  constructor(client: DoMoCodeClient, ref: SessionRef, forget: () => void) { this.client = client; this.ref = ref; this.forget = forget; }
  get id(): string { return this.ref.id; }
  get path(): string { return this.ref.path; }
  get role(): SessionClientAttachment["role"] | undefined { return this.attachment?.role; }
  get clientAttachment(): SessionClientAttachment | undefined { return this.attachment; }
  get eventsEngine(): EventEngine | undefined { return this.engine; }

  setLease(mode: "exclusive" | "shared", release: () => void): void {
    if (this.leaseRelease && mode === "exclusive") throw new SessionAlreadyAcquiredError(this.id);
    this.leaseMode = mode;
    this.leaseRelease = release;
  }

  async release(): Promise<void> { this.leaseRelease?.(); this.leaseRelease = undefined; this.leaseMode = undefined; }

  async attach(options: SessionAttachOptions = {}): Promise<SessionClientAttachment> {
    this.assertUsable();
    const authority = options.authority ?? "require";
    try {
      const resumed = await this.client.transport.json<unknown>("/session", { method: "POST", body: { resume: this.id } });
      this.ref = decodeRef(resumed, this.ref);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await this.status();
    }
    const path = `/session/${encodePathSegment(this.id)}/client/attach`;
    let attachment: SessionClientAttachment;
    try {
      const value = await this.client.transport.json<unknown>(path, { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner, requestAuthority: authority !== "observer" } });
      attachment = decodeAttachment(value, this.id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      // A 404 is only treated as a pre-ledger server after liveness was checked.
      await this.status();
      if (authority === "require") throw new AuthorityUnavailableError(this.id);
      attachment = { clientId: this.client.clientId, sessionId: this.id, owner: this.client.owner, role: "observer", active: true, eventCursor: this.cursor };
    }
    if (authority === "require" && attachment.role !== "authority") {
      const holder = await this.authority().catch(() => undefined);
      throw new AuthorityUnavailableError(this.id, holder);
    }
    this.attachment = attachment;
    this.cursor = Math.max(this.cursor, attachment.eventCursor ?? 0);
    if (!this.engine) {
      this.engine = new EventEngine({
        open: (after, signal) => this.client.transport.request(`${sessionPath(this.id, `/events?after=${after}`)}`, { signal, stream: true }),
        revive: async (signal) => { await this.client.transport.json("/session", { method: "POST", body: { resume: this.id }, signal }); },
        reconcile: (signal) => this.reconcile(signal)
      });
      this.engine.start();
    }
    return attachment;
  }

  events(): EventEngine { this.assertUsable(); if (!this.engine) throw new Error("Session is not attached"); return this.engine; }
  onEvent(listener: EventListener): () => void { return this.events().onEvent(listener); }

  /** Return the session's single interaction dispatcher, creating it lazily. */
  interactionRuntimeFor(options: InteractionRuntimeOptions = {}): InteractionRuntime {
    this.assertUsable();
    if (!this.interactionRuntime) {
      this.interactionRuntime = new InteractionRuntime(options);
      void this.interactionRuntime.attach(this).catch((error) => {
        options.warn?.(`DoMoCode interaction reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return this.interactionRuntime;
  }

  interactions(options: InteractionRuntimeOptions = {}): AsyncIterableIterator<RuntimeInteraction> {
    return this.interactionRuntimeFor(options).interactions();
  }

  onInteraction(handler: InteractionHandler, options: InteractionRuntimeOptions = {}): () => void {
    return this.interactionRuntimeFor(options).onInteraction(handler);
  }

  /** Return the live subagent index; child streams are observed by default. */
  subagents(options: SubagentRegistryOptions = {}): SubagentRegistry {
    this.assertUsable();
    if (!this.subagentRegistry) this.subagentRegistry = new SubagentRegistry(this, options);
    return this.subagentRegistry;
  }

  async prompt(text: string, options: PromptOptions = {}): Promise<void> { await this.postPrompt("prompt", text, options); }
  async steer(text: string, options: PromptOptions = {}): Promise<void> { await this.postPrompt("steer", text, options); }

  async send(text: string, options: SendOptions = {}): Promise<void> {
    const running = (await this.status()).running;
    const preferSteer = options.preferSteer ?? running;
    const first = preferSteer ? "steer" : "prompt";
    const second = preferSteer ? "prompt" : "steer";
    try { await this.postPrompt(first, text, options); }
    catch (error) {
      if (!(error instanceof ConflictError) || !error.route.endsWith(`/${first}`)) throw error;
      try { await this.postPrompt(second, text, options); }
      catch (retryError) {
        if (retryError instanceof ConflictError && retryError.route.endsWith(`/${second}`)) throw new RunStateRaceError(retryError.route);
        throw retryError;
      }
    }
  }

  async abort(): Promise<boolean> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/abort"), { method: "POST" });
    return !isRecord(value) || typeof value.aborted !== "boolean" ? true : value.aborted;
  }

  async forceClear(): Promise<boolean> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/force-clear"), { method: "POST" });
    return !isRecord(value) || typeof value.cleared !== "boolean" ? true : value.cleared;
  }

  async status(): Promise<SessionStatus> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/status"));
    return decodeStatus(value, this.id);
  }

  async accounting(): Promise<SessionAccounting | undefined> { return (await this.status()).accounting; }

  async messages(): Promise<Message[]> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/messages"));
    return requiredArray(value, "messages").map(decodeMessage);
  }

  async transcript(options: TranscriptOptions = {}): Promise<string> {
    return renderTranscript(await this.messages(), options);
  }

  async context(): Promise<ContextSnapshot> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/context"));
    if (!isRecord(value)) throw new TypeError("Context snapshot must be an object");
    return { messages: requiredArray(value.messages, "context.messages").map(decodeMessage), ...(value.accounting === undefined || value.accounting === null ? {} : { accounting: decodeAccounting(value.accounting) }) };
  }

  async setModel(modelId: string): Promise<void> { await this.client.transport.json(sessionPath(this.id, "/model"), { method: "POST", body: { modelID: modelId } }); }
  async setMode(mode: string): Promise<void> { await this.client.transport.json(sessionPath(this.id, "/mode"), { method: "POST", body: { mode } }); }

  async fork(options: SessionAttachOptions = {}): Promise<SessionHandle> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/fork"), { method: "POST", expectedStatus: 201 });
    const ref = decodeRef(value, { id: "", path: "" });
    const handle = this.client.sessions.getOrCreate(ref);
    await handle.attach(options);
    return handle;
  }

  async clone(options: SessionAttachOptions = {}): Promise<SessionHandle> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/clone"), { method: "POST", expectedStatus: 201 });
    const ref = decodeRef(value, { id: "", path: "" });
    const handle = this.client.sessions.getOrCreate(ref);
    await handle.attach(options);
    return handle;
  }

  async rename(name: string | null): Promise<void> { await this.client.transport.json(sessionPath(this.id, "/rename"), { method: "POST", body: { name } }); }
  async autoTitle(): Promise<string | undefined> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/title"), { method: "POST" });
    return isRecord(value) && typeof value.title === "string" ? value.title : undefined;
  }
  async setLabel(targetId: string, label: string | null): Promise<void> { await this.client.transport.json(sessionPath(this.id, "/label"), { method: "POST", body: { targetID: targetId, label } }); }
  async moveLeaf(targetId: string | null): Promise<void> { await this.client.transport.json(sessionPath(this.id, "/leaf"), { method: "POST", body: { targetID: targetId } }); }
  async commitMessage(): Promise<string | undefined> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/diff/commit-message"), { method: "POST" });
    return isRecord(value) && typeof value.message === "string" ? value.message : undefined;
  }

  async tools(filter: ToolCatalogFilter = {}): Promise<ToolCatalogEntry[]> {
    return filterToolCatalog(decodeToolCatalog(await this.client.transport.json<unknown>(sessionPath(this.id, "/tools"))), filter);
  }

  /**
   * Compatibility path for MCP resources on servers before the MCP admin routes.
   * The server still owns MCP connections and returns its bounded direct-tool result.
   */
  async mcpResource(action: McpResourceAction, options: McpResourceOptions = {}): Promise<DirectToolResult> {
    if (action === "read" && (!options.server || !options.uri)) throw new TypeError("mcp_resource read requires server and uri");
    const argumentsValue: Record<string, JSONValue> = { action, ...(options.server === undefined ? {} : { server: options.server }), ...(options.uri === undefined ? {} : { uri: options.uri }) };
    return this.executeTool("mcp_resource", argumentsValue);
  }

  async executeTool(name: string, argumentsValue: Record<string, JSONValue> = {}): Promise<DirectToolResult> {
    if (!/^[A-Za-z0-9_.:-]+$/.test(name)) throw new TypeError("Tool name contains unsupported direct-command characters");
    return this.executeToolCommand(`/${name} ${JSON.stringify(argumentsValue)}`);
  }

  async executeToolCommand(command: string): Promise<DirectToolResult> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/tool"), { method: "POST", body: { command } });
    return decodeDirectToolResult(value);
  }

  async task(prompt: string, options: TaskOptions = {}): Promise<DirectToolResult> {
    return this.executeTool("task", {
      prompt,
      ...(options.taskId === undefined ? {} : { task_id: options.taskId }),
      ...(options.agent === undefined ? {} : { agent: options.agent }),
      ...(options.background === undefined ? {} : { background: options.background }),
      ...(options.model === undefined ? {} : { model: options.model })
    });
  }

  async resumeTask(taskId: string, prompt = "", options: Omit<TaskOptions, "taskId"> = {}): Promise<DirectToolResult> {
    return this.task(prompt, { ...options, taskId });
  }

  async answerPermission(requestId: string, reply: "once" | "always" | "reject", message?: string): Promise<void> {
    const body = { requestID: requestId, reply, ...(message === undefined ? {} : { message }) };
    await this.client.transport.json(sessionPath(this.id, "/permission"), { method: "POST", body });
  }

  async answerQuestion(requestId: string, answers: QuestionAnswer[] | null): Promise<void> {
    await this.client.transport.json(sessionPath(this.id, "/question"), { method: "POST", body: { requestID: requestId, answers } });
  }

  async pendingPermissions(): Promise<ServerEvent[]> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/permissions"));
    return requiredArray(value, "permissions").map(decodeServerEvent);
  }

  async pendingQuestions(): Promise<ServerEvent[]> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/questions"));
    return requiredArray(value, "questions").map(decodeServerEvent);
  }

  async settled(options: SettleOptions = {}): Promise<SettleResult> {
    const idle = options.maxIdleMs ?? 5_000;
    const initial = await this.status();
    if (!initial.running) {
      const pending = await this.pendingInteractionPayloads(initial);
      if (pending.length > 0) throw new RunStalledError(pending);
      return { stopReason: "idle", status: initial };
    }
    let reason: string | undefined;
    const unsubscribe = this.engine?.onEvent((event) => {
      if (event.type === "agent_end" && "reason" in event) reason = event.reason;
    });
    const started = Date.now();
    try {
      while (Date.now() - started < idle) {
        const current = await this.status();
        if (!current.running) {
          const pending = await this.pendingInteractionPayloads(current);
          if (pending.length > 0) throw new RunStalledError(pending);
          return { stopReason: reason ?? "completed", status: current };
        }
        await delay(50);
      }
      const pending = await this.pendingInteractionPayloads(await this.status());
      if (pending.length > 0) throw new RunStalledError(pending);
      return { stopReason: reason ?? "unknown", status: await this.status() };
    } finally { unsubscribe?.(); }
  }

  async run(prompt: string, options: PromptOptions & SettleOptions = {}): Promise<RunResult> {
    if (this.runLock) throw new SessionBusyError({ status: 409, route: sessionPath(this.id, "/prompt") });
    this.runLock = true;
    const notices: RunResult["notices"] = [];
    const unsubscribe = this.engine?.onEvent((event) => { if (event.type === "notice" && "notice" in event) notices.push(event.notice); });
    try {
      await this.prompt(prompt, options);
      const settled = await this.settled(options);
      const stopReason = settled.stopReason === "idle" ? "completed" : settled.stopReason;
      if (stopReason === "errored") throw new DoMoError("DoMoCode run errored.");
      return { stopReason, messages: await this.messages(), ...(settled.status.accounting === undefined ? {} : { accounting: settled.status.accounting }), notices };
    } finally { unsubscribe?.(); this.runLock = false; }
  }

  async attachAuthority(): Promise<SessionClientAttachment> { return this.attach({ authority: "require" }); }
  async requestAuthority(): Promise<SessionClientAttachment> { return this.attach({ authority: "require" }); }

  async releaseAuthority(): Promise<SessionClientAttachment> {
    const path = sessionPath(this.id, "/client/authority/release");
    const value = await this.client.transport.json<unknown>(path, { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner } });
    const attachment = decodeAttachment(value, this.id); this.attachment = attachment; return attachment;
  }

  async transferAuthority(toClientId: string): Promise<SessionClientAttachment> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/client/authority/transfer"), { method: "POST", body: { fromClientID: this.client.clientId, toClientID: toClientId, owner: this.client.owner } });
    return decodeAttachment(value, this.id);
  }

  async authority(): Promise<SessionClientAttachment | undefined> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/client/authority"));
    return value === null ? undefined : decodeAttachment(value, this.id);
  }

  async clients(includeInactive = false): Promise<SessionClientAttachment[]> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, `/clients?includeInactive=${includeInactive}`));
    return requiredArray(value, "clients").map((item) => decodeAttachment(item, this.id));
  }

  async clientEvents(after = 0): Promise<SessionClientEvent[]> { const value = await this.client.transport.json<unknown>(sessionPath(this.id, `/client/events?after=${after}`)); return requiredArray(value, "client events") as SessionClientEvent[]; }
  async clientJournal(clientId?: string): Promise<SessionClientJournalEntry[]> { const query = clientId ? `?clientID=${encodeURIComponent(clientId)}` : ""; const value = await this.client.transport.json<unknown>(sessionPath(this.id, `/client/export${query}`)); return requiredArray(value, "client journal") as SessionClientJournalEntry[]; }

  async advanceCursor(sequence = this.engine?.lastSequence ?? this.cursor): Promise<SessionClientAttachment> {
    const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/client/cursor"), { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner, sequence } });
    this.cursor = Math.max(this.cursor, sequence); const attachment = decodeAttachment(value, this.id); this.attachment = attachment; return attachment;
  }

  async diff(base?: string): Promise<GitDiff> { const query = base ? `?base=${encodeURIComponent(base)}` : ""; return this.client.transport.json<GitDiff>(sessionPath(this.id, `/diff${query}`)); }
  async workspaceStatus(): Promise<WorkspaceSnapshotStatus> { return this.client.transport.json<WorkspaceSnapshotStatus>(sessionPath(this.id, "/workspace-status")); }
  async undo(): Promise<WorkspaceHistoryResult> { return this.client.transport.json<WorkspaceHistoryResult>(sessionPath(this.id, "/undo"), { method: "POST" }); }
  async redo(): Promise<WorkspaceHistoryResult> { return this.client.transport.json<WorkspaceHistoryResult>(sessionPath(this.id, "/redo"), { method: "POST" }); }
  async children(parent?: string): Promise<SessionTreeEntry[]> { const query = parent ? `?parent=${encodeURIComponent(parent)}` : ""; return this.client.transport.json<SessionTreeEntry[]>(sessionPath(this.id, `/children${query}`)); }
  async tree(): Promise<SessionTreeEntry[]> { return this.client.transport.json<SessionTreeEntry[]>(sessionPath(this.id, "/tree")); }
  async timeline(): Promise<SessionTreeEntry[]> { return this.client.transport.json<SessionTreeEntry[]>(sessionPath(this.id, "/timeline")); }
  async compact(): Promise<boolean> { const value = await this.client.transport.json<unknown>(sessionPath(this.id, "/compact"), { method: "POST" }); return isRecord(value) && typeof value.compacted === "boolean" ? value.compacted : true; }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.interactionRuntime?.close();
    await this.subagentRegistry?.close();
    try { if (this.engine) await this.engine.stop(); } catch { /* disposal is best effort */ }
    try { if (this.engine && this.engine.lastSequence > this.cursor && this.attachment) await this.advanceCursor(this.engine.lastSequence); } catch { /* best effort */ }
    try { if (this.attachment?.role === "authority") await this.releaseAuthority(); } catch { /* best effort */ }
    try { if (this.attachment) await this.client.transport.json(sessionPath(this.id, "/client/detach"), { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner } }); } catch { /* best effort */ }
    this.leaseRelease?.();
    this.leaseRelease = undefined;
    this.forget();
  }

  async [Symbol.asyncDispose](): Promise<void> { await this.dispose(); }

  private async postPrompt(route: "prompt" | "steer", text: string, options: PromptOptions): Promise<void> {
    this.assertUsable();
    const body = options.images && options.images.length > 0 ? { prompt: text, images: options.images } : { prompt: text };
    await this.client.transport.json(sessionPath(this.id, `/${route}`), { method: "POST", body, expectedStatus: 202 });
  }

  private async pendingInteractionPayloads(status: SessionStatus): Promise<unknown[]> {
    const permissionIds = new Set(status.pendingPermissionIds);
    const questionIds = new Set(status.pendingQuestionIds ?? []);
    const payloads: unknown[] = [];
    const known = new Set<string>();
    for (const interaction of this.interactionRuntime?.pending() ?? []) {
      const key = interaction.kind === "permission" ? `permission:${interaction.id}` : interaction.kind === "question" ? `question:${interaction.id}` : `${interaction.kind}:${interaction.id}`;
      if ((interaction.kind === "permission" && permissionIds.has(interaction.id)) || (interaction.kind === "question" && questionIds.has(interaction.id)) || (interaction.kind !== "permission" && interaction.kind !== "question")) {
        payloads.push(interaction);
        known.add(key);
      }
    }
    if (permissionIds.size === 0 && questionIds.size === 0) return payloads;

    const pendingEvents = await Promise.all([
      this.pendingPermissions().catch(() => []),
      this.pendingQuestions().catch(() => [])
    ]);
    for (const event of pendingEvents.flat()) {
      if (event.type === "permission_request" && "id" in event && permissionIds.has(event.id)) {
        const key = `permission:${event.id}`;
        if (!known.has(key)) { payloads.push(event); known.add(key); }
      } else if (event.type === "question_request" && "id" in event && questionIds.has(event.id)) {
        const key = `question:${event.id}`;
        if (!known.has(key)) { payloads.push(event); known.add(key); }
      }
    }
    for (const id of permissionIds) if (!known.has(`permission:${id}`)) payloads.push({ kind: "permission", id, sessionId: this.id, raw: { id, sessionId: this.id, source: "status" } });
    for (const id of questionIds) if (!known.has(`question:${id}`)) payloads.push({ kind: "question", id, sessionId: this.id, raw: { id, sessionId: this.id, source: "status" } });
    return payloads;
  }

  private async reconcile(signal: AbortSignal): Promise<unknown[]> {
    const events: unknown[] = [];
    for (const route of ["/permissions", "/questions"] as const) {
      try { events.push(...requiredArray(await this.client.transport.json<unknown>(sessionPath(this.id, route), { signal }), route)); }
      catch (error) { if (!(error instanceof NotFoundError)) throw error; }
    }
    return events;
  }

  private assertUsable(): void { if (this.disposed) throw new Error("Session handle has been disposed"); }
}

function decodeRef(value: unknown, fallback: SessionRef): SessionRef { return isRecord(value) && typeof value.id === "string" && typeof value.path === "string" ? { id: value.id, path: value.path } : fallback; }

export function decodeAttachment(value: unknown, fallbackSessionId: string): SessionClientAttachment {
  if (!isRecord(value)) throw new TypeError("Client attachment must be an object");
  const clientId = requiredString(value.clientID ?? value.clientId, "clientID");
  const sessionId = typeof (value.sessionID ?? value.sessionId) === "string" ? String(value.sessionID ?? value.sessionId) : fallbackSessionId;
  const role = value.role === "authority" ? "authority" : "observer";
  return { clientId, sessionId, owner: requiredString(value.owner, "owner"), role, active: value.active === undefined ? true : requiredBoolean(value.active, "active"), ...(value.attachedAt === undefined ? {} : { attachedAt: requiredString(value.attachedAt, "attachedAt") }), ...(value.updatedAt === undefined ? {} : { updatedAt: requiredString(value.updatedAt, "updatedAt") }), eventCursor: value.eventCursor === undefined ? 0 : requiredNumber(value.eventCursor, "eventCursor") };
}

export function decodeStatus(value: unknown, fallbackSessionId: string): SessionStatus {
  if (!isRecord(value)) throw new TypeError("Session status must be an object");
  const pendingPermissionIds = requiredArray(value.pendingPermissionIDs ?? value.pendingPermissionIds, "pending permissions").map((item) => requiredString(item, "permission id"));
  const questions = value.pendingQuestionIDs ?? value.pendingQuestionIds;
  return { sessionId: typeof (value.sessionID ?? value.sessionId) === "string" ? String(value.sessionID ?? value.sessionId) : fallbackSessionId, running: requiredBoolean(value.running, "running"), pendingPermissionIds, ...(questions === undefined || questions === null ? {} : { pendingQuestionIds: requiredArray(questions, "pending questions").map((item) => requiredString(item, "question id")) }), subscribers: requiredNumber(value.subscribers, "subscribers"), ...(value.runStartedAt === undefined || value.runStartedAt === null ? {} : { runStartedAt: requiredString(value.runStartedAt, "runStartedAt") }), ...(value.accounting === undefined || value.accounting === null ? {} : { accounting: decodeAccounting(value.accounting) }), ...(value.queuedMessageCount === undefined || value.queuedMessageCount === null ? {} : { queuedMessageCount: requiredNumber(value.queuedMessageCount, "queuedMessageCount") }), ...(value.steeringMode === undefined || value.steeringMode === null ? {} : { steeringMode: String(value.steeringMode) }), ...(value.mode === undefined || value.mode === null ? {} : { mode: String(value.mode) }), ...(value.agent === undefined || value.agent === null ? {} : { agent: String(value.agent) }) };
}

export function decodeAccounting(value: unknown): SessionAccounting {
  if (!isRecord(value)) throw new TypeError("Accounting must be an object");
  const rawCost = value.costTotal;
  const costTotal = typeof rawCost === "string" || typeof rawCost === "number" ? asDecimalString(String(rawCost)) : asDecimalString("0");
  return { costTotal, contextTokens: requiredNumber(value.contextTokens ?? 0, "contextTokens"), turns: requiredNumber(value.turns ?? 0, "turns"), ...(value.contextWindow === undefined || value.contextWindow === null ? {} : { contextWindow: requiredNumber(value.contextWindow, "contextWindow") }), ...(isRecord(value.usage) ? { usage: { input: requiredNumber(value.usage.input ?? 0, "usage.input"), output: requiredNumber(value.usage.output ?? 0, "usage.output"), cacheRead: requiredNumber(value.usage.cacheRead ?? 0, "usage.cacheRead"), cacheWrite: requiredNumber(value.usage.cacheWrite ?? 0, "usage.cacheWrite") } } : {}) };
}

function sessionPath(id: string, suffix = ""): string { return `/session/${encodePathSegment(id)}${suffix}`; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function decodeDirectToolResult(value: unknown): DirectToolResult {
  if (!isRecord(value)) throw new TypeError("Direct tool result must be an object");
  return {
    toolName: requiredString(value.toolName, "toolName"),
    output: requiredString(value.output, "output"),
    isError: requiredBoolean(value.isError, "isError"),
    imageCount: requiredNumber(value.imageCount ?? 0, "imageCount")
  };
}
