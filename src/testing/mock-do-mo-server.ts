import type { FetchFunction } from "../transport.ts";
import { Transport } from "../transport.ts";
import { uuidv7 } from "../uuid.ts";
import type { JSONValue } from "../types/common.ts";
import { isRecord } from "../types/common.ts";
import type { QuestionPrompt } from "../types/asks.ts";
import type { ServerEvent } from "../types/events.ts";
import type { Message } from "../types/messages.ts";
import type { SessionClientAttachment, SessionRef, SessionStatus } from "../types/sessions.ts";
import type { SkillDescriptor, ToolCatalogEntry } from "../types/catalogs.ts";

export interface MockPromptContext {
  sessionId: string;
  prompt: string;
  images: unknown[];
  server: MockDoMoServer;
}

export interface MockPromptResult {
  message?: Message;
  events?: ServerEvent[];
  stopReason?: string;
}

export interface MockDoMoServerOptions {
  token?: string;
  protocolVersion?: number;
  version?: string;
  autoComplete?: boolean;
  promptHandler?: (context: MockPromptContext) => Promise<MockPromptResult | void> | MockPromptResult | void;
  capabilities?: string[];
  toolCatalog?: ToolCatalogEntry[];
  skillCatalog?: SkillDescriptor[];
}

interface SequencedEvent { sequence: number; event: ServerEvent }
interface StreamState { controller: ReadableStreamDefaultController<Uint8Array>; heartbeat: ReturnType<typeof setInterval>; close: () => void }
interface MockSession {
  ref: SessionRef;
  summary: { id: string; path: string; cwd: string; timestamp: string; name?: string };
  running: boolean;
  runId?: string;
  events: SequencedEvent[];
  nextSequence: number;
  streams: Set<StreamState>;
  permissions: Map<string, Extract<ServerEvent, { type: "permission_request" }>>;
  questions: Map<string, Extract<ServerEvent, { type: "question_request" }>>;
  clients: Map<string, SessionClientAttachment>;
  messages: Message[];
  queued: number;
  model: string;
  mode: string;
  finishAfterInteractions: boolean;
}

const encoder = new TextEncoder();

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

function bodyObject(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string" || init.body.length === 0) return {};
  const parsed: unknown = JSON.parse(init.body);
  return isRecord(parsed) ? parsed : {};
}

/**
 * A deterministic, protocol-shaped in-process DoMoCode server.
 *
 * It intentionally implements the same fetch seam as a browser/server runtime:
 * pass `server.fetch` to `Transport`, or use `server.transport()`. No TCP or
 * Node-only API is required, which keeps it suitable for browser tests too.
 */
export class MockDoMoServer {
  readonly token: string;
  readonly baseURL = "http://mock.domocode.test";
  readonly protocolVersion: number;
  readonly version: string;
  readonly capabilities: string[];
  readonly fetch: FetchFunction;
  private readonly autoComplete: boolean;
  private readonly promptHandler: MockDoMoServerOptions["promptHandler"];
  private readonly toolCatalog: ToolCatalogEntry[];
  private readonly skillCatalog: SkillDescriptor[];
  private readonly sessionsById = new Map<string, MockSession>();
  private closed = false;

  constructor(options: MockDoMoServerOptions = {}) {
    this.token = options.token ?? "mock-token";
    this.protocolVersion = options.protocolVersion ?? 1;
    this.version = options.version ?? "mock";
    this.capabilities = options.capabilities ?? ["session-events", "questions", "permissions", "client-ledger"];
    this.autoComplete = options.autoComplete ?? true;
    this.promptHandler = options.promptHandler;
    this.toolCatalog = options.toolCatalog ?? [{ name: "read", description: "Read a file", source: "builtIn", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, permission: "allowed", metadata: { mock: true } }];
    this.skillCatalog = options.skillCatalog ?? [];
    this.fetch = this.handleFetch.bind(this);
  }

  transport(options: Partial<Omit<ConstructorParameters<typeof Transport>[0], "baseURL" | "token" | "fetch">> = {}): Transport {
    return new Transport({ baseURL: this.baseURL, token: this.token, fetch: this.fetch, ...options });
  }

  session(id: string): SessionRef | undefined { return this.sessionsById.get(id)?.ref; }

  async createSession(resume?: string): Promise<SessionRef> {
    if (resume) {
      const existing = this.sessionsById.get(resume);
      if (!existing) throw new Error(`Unknown mock session ${resume}`);
      return existing.ref;
    }
    const id = uuidv7();
    const ref = { id, path: `/tmp/.domocode/${id}.jsonl` };
    this.sessionsById.set(id, {
      ref,
      summary: { id, path: ref.path, cwd: "/tmp/mock-workspace", timestamp: new Date().toISOString() },
      running: false,
      events: [],
      nextSequence: 1,
      streams: new Set(),
      permissions: new Map(),
      questions: new Map(),
      clients: new Map(),
      messages: [],
      queued: 0,
      model: "mock-model",
      mode: "build",
      finishAfterInteractions: false
    });
    return ref;
  }

  emit(sessionId: string, event: ServerEvent): number {
    const session = this.requireSession(sessionId);
    if (event.type === "heartbeat" || event.type === "connected") return 0;
    const sequence = session.nextSequence++;
    session.events.push({ sequence, event });
    if (session.events.length > 2048) session.events.shift();
    if (event.type === "permission_request" && "id" in event) session.permissions.set(event.id, event as Extract<ServerEvent, { type: "permission_request" }>);
    if (event.type === "permission_resolved" && "id" in event) session.permissions.delete(event.id);
    if (event.type === "question_request" && "id" in event) session.questions.set(event.id, event as Extract<ServerEvent, { type: "question_request" }>);
    if (event.type === "question_resolved" && "id" in event) session.questions.delete(event.id);
    for (const stream of session.streams) this.enqueue(stream, { ...event, sequence });
    return sequence;
  }

  async requestPermission(sessionId: string, request: Omit<Extract<ServerEvent, { type: "permission_request" }>, "type">): Promise<void> {
    this.emit(sessionId, { type: "permission_request", ...request });
  }

  async requestQuestion(sessionId: string, request: Omit<Extract<ServerEvent, { type: "question_request" }>, "type">): Promise<void> {
    this.emit(sessionId, { type: "question_request", ...request });
  }

  close(): void {
    this.closed = true;
    for (const session of this.sessionsById.values()) {
      for (const stream of session.streams) stream.close();
      session.streams.clear();
    }
  }

  private async handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.closed) return errorResponse(503, "MockDoMoServer is closed");
    const url = new URL(input instanceof Request ? input.url : input.toString(), this.baseURL);
    if (readHeader(init?.headers, "authorization") !== `Bearer ${this.token}`) return new Response(null, { status: 401 });
    const method = init?.method?.toUpperCase() ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    try {
      if (method === "GET" && url.pathname === "/capabilities") return jsonResponse({ name: "domocode", version: this.version, protocolVersion: this.protocolVersion, capabilities: this.capabilities });
      if (method === "GET" && url.pathname === "/sessions") return jsonResponse([...this.sessionsById.values()].map((session) => session.summary));
      if (method === "POST" && url.pathname === "/session") {
        const body = bodyObject(init);
        return jsonResponse(await this.createSession(typeof body.resume === "string" ? body.resume : undefined), 201);
      }
      if (parts[0] !== "session" || !parts[1]) return this.handleGlobal(method, parts, url, init);
      const session = this.sessionsById.get(parts[1]);
      if (!session) return errorResponse(404, "session not found");
      const tail = parts.slice(2);
      if (method === "GET" && tail[0] === "events") return this.openEvents(session, Number(url.searchParams.get("after") ?? "0"), init?.signal ?? undefined);
      if (method === "GET" && tail[0] === "status") return jsonResponse(this.status(session));
      if (method === "GET" && tail[0] === "messages") return jsonResponse(session.messages);
      if (method === "GET" && tail[0] === "context") return jsonResponse({ messages: session.messages, accounting: null });
      if (method === "GET" && tail[0] === "permissions") return jsonResponse([...session.permissions.values()]);
      if (method === "GET" && tail[0] === "questions") return jsonResponse([...session.questions.values()]);
      if (method === "GET" && tail[0] === "tools") return jsonResponse(this.tools(session));
      if (method === "POST" && tail[0] === "prompt") return this.isAuthority(session, init) ? this.prompt(session, bodyObject(init)) : errorResponse(403, "authority required");
      if (method === "POST" && tail[0] === "steer") return this.isAuthority(session, init) ? this.steer(session, bodyObject(init)) : errorResponse(403, "authority required");
      if (method === "POST" && tail[0] === "abort") { if (!this.isAuthority(session, init)) return errorResponse(403, "authority required"); const aborted = session.running; session.running = false; return jsonResponse({ aborted }); }
      if (method === "POST" && tail[0] === "force-clear") { if (!this.isAuthority(session, init)) return errorResponse(403, "authority required"); const cleared = session.running; session.running = false; return jsonResponse({ cleared }); }
      if (method === "POST" && tail[0] === "permission") return this.isAuthority(session, init) ? this.answerPermission(session, bodyObject(init)) : errorResponse(403, "authority required");
      if (method === "POST" && tail[0] === "question") return this.isAuthority(session, init) ? this.answerQuestion(session, bodyObject(init)) : errorResponse(403, "authority required");
      if (method === "POST" && tail[0] === "tool") return this.isAuthority(session, init) ? this.executeTool(session, bodyObject(init)) : errorResponse(403, "authority required");
      if (method === "POST" && tail[0] === "fork") return this.fork(session);
      if (method === "POST" && tail[0] === "clone") return this.fork(session);
      if (method === "POST" && tail[0] === "rename") { const name = bodyObject(init).name; if (typeof name === "string") session.summary.name = name; else if (name === null) delete session.summary.name; return jsonResponse({}); }
      if (method === "POST" && tail[0] === "title") return jsonResponse({ title: session.summary.name ?? "Mock session" });
      if (method === "POST" && tail[0] === "label") return jsonResponse({});
      if (method === "POST" && tail[0] === "leaf") return jsonResponse({});
      if (method === "POST" && tail[0] === "diff" && tail[1] === "commit-message") return jsonResponse({ message: "Mock commit message" });
      if (method === "POST" && tail[0] === "client" && tail[1] === "attach") return this.attach(session, bodyObject(init));
      if (method === "POST" && tail[0] === "client" && tail[1] === "detach") return this.detach(session, bodyObject(init));
      if (method === "POST" && tail[0] === "client" && tail[1] === "cursor") return this.advanceCursor(session, bodyObject(init));
      if (method === "POST" && tail[0] === "client" && tail[1] === "authority" && tail[2] === "release") return this.releaseAuthority(session, bodyObject(init));
      if (method === "POST" && tail[0] === "client" && tail[1] === "authority" && tail[2] === "transfer") return this.transferAuthority(session, bodyObject(init));
      if (method === "GET" && tail[0] === "clients") return jsonResponse([...session.clients.values()]);
      if (method === "GET" && tail[0] === "authority") return jsonResponse([...session.clients.values()].find((client) => client.role === "authority") ?? null);
      if (method === "GET" && tail[0] === "client" && tail[1] === "authority") return jsonResponse([...session.clients.values()].find((client) => client.role === "authority") ?? null);
      if (method === "GET" && tail[0] === "client" && tail[1] === "events") return jsonResponse([]);
      if (method === "GET" && tail[0] === "client" && tail[1] === "export") return jsonResponse([]);
      if (method === "POST" && tail[0] === "model") { if (!this.isAuthority(session, init)) return errorResponse(403, "authority required"); session.model = String(bodyObject(init).modelId ?? session.model); this.emit(session.ref.id, { type: "notice", notice: { level: "info", code: "model", text: session.model } }); return jsonResponse({}); }
      if (method === "POST" && tail[0] === "mode") { if (!this.isAuthority(session, init)) return errorResponse(403, "authority required"); session.mode = String(bodyObject(init).mode ?? session.mode); this.emit(session.ref.id, { type: "notice", notice: { level: "info", code: "mode", text: session.mode } }); return jsonResponse({}); }
      return errorResponse(404, "route not found");
    } catch (error) {
      return errorResponse(400, error instanceof Error ? error.message : "mock request failed");
    }
  }

  private handleGlobal(method: string, parts: string[], url: URL, init?: RequestInit): Response {
    if (method === "GET" && parts[0] === "commands") return jsonResponse({ commands: [{ name: "help", description: "Mock command", source: "builtIn" }] });
    if (method === "GET" && parts[0] === "agents") return jsonResponse([{ name: "default", description: "Mock agent", mode: "build", source: "builtIn" }]);
    if (method === "GET" && parts[0] === "skills") {
      const includeBody = url.searchParams.get("include") === "body";
      return jsonResponse(this.skillCatalog.map((skill) => includeBody || skill.body === undefined ? skill : (({ body: _body, ...metadata }) => metadata)(skill)));
    }
    if (method === "GET" && parts[0] === "models") return jsonResponse([{ id: "mock-model", provider: "mock" }]);
    if (method === "GET" && parts[0] === "memory") return jsonResponse([]);
    return errorResponse(404, `route not found: ${url.pathname}`);
  }

  private openEvents(session: MockSession, after: number, signal?: AbortSignal): Response {
    let activeState: StreamState | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const state: StreamState = {
          controller,
          heartbeat: setInterval(() => this.enqueue(state, { type: "heartbeat" }), 15_000),
          close: () => {
            clearInterval(state.heartbeat);
            session.streams.delete(state);
            try { controller.close(); } catch { /* already closed */ }
          }
        };
        activeState = state;
        session.streams.add(state);
        this.enqueue(state, { type: "connected", protocolVersion: this.protocolVersion, sessionId: session.ref.id, running: session.running });
        for (const item of session.events) if (item.sequence > after) this.enqueue(state, { ...item.event, sequence: item.sequence });
        if (signal) {
          const abort = () => state.close();
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }
      },
      cancel: () => { activeState?.close(); }
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }

  private enqueue(stream: StreamState, event: Record<string, unknown>): void {
    try { stream.controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { stream.close(); }
  }

  private async prompt(session: MockSession, body: Record<string, unknown>): Promise<Response> {
    if (session.running) return errorResponse(409, "session is busy");
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    session.running = true;
    session.runId = uuidv7();
    const runId = session.runId;
    void this.runPrompt(session, prompt, Array.isArray(body.images) ? body.images : []).catch((error) => {
      if (session.runId === runId) {
        this.emit(session.ref.id, { type: "notice", notice: { level: "error", code: "runtime_error", text: error instanceof Error ? error.message : "mock run failed" } });
      this.emit(session.ref.id, { type: "agent_end", reason: "errored", ...(runId === undefined ? {} : { runId }) });
        session.running = false;
      }
    });
    return jsonResponse({ runId }, 202);
  }

  private async runPrompt(session: MockSession, prompt: string, images: unknown[]): Promise<void> {
    this.emit(session.ref.id, { type: "agent_start" });
    this.emit(session.ref.id, { type: "turn_start" });
    const result = this.promptHandler ? await this.promptHandler({ sessionId: session.ref.id, prompt, images, server: this }) : undefined;
    for (const event of result?.events ?? []) this.emit(session.ref.id, event);
    if (result?.message) {
      session.messages.push(result.message);
      this.emit(session.ref.id, { type: "message_start", message: result.message });
      this.emit(session.ref.id, { type: "message_end", message: result.message });
    }
    const waitingForInteraction = (result?.events ?? []).some((event) => event.type === "permission_request" || event.type === "question_request");
    if (this.autoComplete && waitingForInteraction) {
      session.finishAfterInteractions = true;
      return;
    }
    if (this.autoComplete) {
      if (!result?.message && !result?.events) {
        const message: Message = { role: "assistant", content: [{ type: "text", text: `Mock response: ${prompt}` }], model: session.model, usage: { input: prompt.length, output: 3, cacheRead: 0, cacheWrite: 0, cost: { input: "0", output: "0", cacheRead: "0", cacheWrite: "0" } }, stopReason: "stop" };
        session.messages.push(message);
        this.emit(session.ref.id, { type: "message_start", message });
        this.emit(session.ref.id, { type: "message_end", message });
      }
      this.emit(session.ref.id, { type: "turn_end" });
      this.emit(session.ref.id, { type: "agent_end", reason: result?.stopReason ?? "completed", ...(session.runId === undefined ? {} : { runId: session.runId }) });
      session.running = false;
    }
  }

  private finishMockRun(session: MockSession): void {
    if (!session.running || !session.finishAfterInteractions) return;
    session.finishAfterInteractions = false;
    this.emit(session.ref.id, { type: "turn_end" });
    this.emit(session.ref.id, { type: "agent_end", reason: "completed", ...(session.runId === undefined ? {} : { runId: session.runId }) });
    session.running = false;
  }

  private steer(session: MockSession, body: Record<string, unknown>): Response {
    if (!session.running) return errorResponse(409, "session is not running");
    session.queued += 1;
    this.emit(session.ref.id, { type: "queue_update", count: session.queued, mode: "all" });
    return jsonResponse({ queued: session.queued }, 202);
  }

  private answerPermission(session: MockSession, body: Record<string, unknown>): Response {
    const id = typeof body.requestID === "string" ? body.requestID : "";
    if (!session.permissions.has(id)) return jsonResponse({});
    this.emit(session.ref.id, { type: "permission_resolved", id });
    this.finishMockRun(session);
    return jsonResponse({});
  }

  private answerQuestion(session: MockSession, body: Record<string, unknown>): Response {
    const id = typeof body.requestID === "string" ? body.requestID : "";
    if (!session.questions.has(id)) return jsonResponse({});
    this.emit(session.ref.id, { type: "question_resolved", id });
    this.finishMockRun(session);
    return jsonResponse({});
  }

  private executeTool(session: MockSession, body: Record<string, unknown>): Response {
    const command = typeof body.command === "string" ? body.command.trim() : "";
    const toolName = (command.split(/\s+/, 1)[0] ?? "unknown").replace(/^\//, "");
    this.emit(session.ref.id, { type: "tool_start", id: uuidv7(), name: toolName, arguments: {} });
    return jsonResponse({ toolName, output: `mock ${command}`, isError: false, imageCount: 0 });
  }

  private async fork(_session: MockSession): Promise<Response> {
    return jsonResponse(await this.createSession(), 201);
  }

  private attach(session: MockSession, body: Record<string, unknown>): Response {
    const clientId = typeof body.clientID === "string" ? body.clientID : uuidv7();
    const owner = typeof body.owner === "string" ? body.owner : clientId;
    const requestAuthority = body.requestAuthority !== false;
    const currentAuthority = [...session.clients.values()].find((client) => client.role === "authority" && client.active);
    const role = !requestAuthority || (currentAuthority && currentAuthority.clientId !== clientId) ? "observer" : "authority";
    const attachment: SessionClientAttachment = { clientId, sessionId: session.ref.id, owner, role, active: true, eventCursor: 0 };
    session.clients.set(clientId, attachment);
    return jsonResponse(attachment);
  }

  private detach(session: MockSession, body: Record<string, unknown>): Response {
    const clientId = typeof body.clientID === "string" ? body.clientID : "";
    const existing = session.clients.get(clientId);
    if (existing) existing.active = false;
    return jsonResponse(existing ?? { clientId, owner: "", role: "observer", active: false });
  }

  private advanceCursor(session: MockSession, body: Record<string, unknown>): Response {
    const clientId = typeof body.clientID === "string" ? body.clientID : "";
    const attachment = session.clients.get(clientId);
    if (!attachment) return errorResponse(404, "client not attached");
    const sequence = typeof body.sequence === "number" && Number.isSafeInteger(body.sequence) ? body.sequence : attachment.eventCursor;
    attachment.eventCursor = Math.max(attachment.eventCursor, sequence);
    return jsonResponse(attachment);
  }

  private releaseAuthority(session: MockSession, body: Record<string, unknown>): Response {
    const clientId = typeof body.clientID === "string" ? body.clientID : "";
    const attachment = session.clients.get(clientId);
    if (!attachment || attachment.role !== "authority") return errorResponse(403, "authority required");
    attachment.role = "observer";
    return jsonResponse(attachment);
  }

  private transferAuthority(session: MockSession, body: Record<string, unknown>): Response {
    const fromClientId = typeof body.fromClientID === "string" ? body.fromClientID : "";
    const toClientId = typeof body.toClientID === "string" ? body.toClientID : "";
    const current = session.clients.get(fromClientId);
    const target = session.clients.get(toClientId);
    if (!current || current.role !== "authority" || !target) return errorResponse(403, "authority required");
    current.role = "observer";
    target.role = "authority";
    target.active = true;
    return jsonResponse(target);
  }

  private tools(_session: MockSession): ToolCatalogEntry[] {
    return this.toolCatalog;
  }

  private status(session: MockSession): SessionStatus {
    return { sessionId: session.ref.id, running: session.running, pendingPermissionIds: [...session.permissions.keys()], pendingQuestionIds: [...session.questions.keys()], subscribers: session.streams.size, queuedMessageCount: session.queued, mode: session.mode, agent: "default" };
  }

  private isAuthority(session: MockSession, init?: RequestInit): boolean {
    const clientId = readHeader(init?.headers, "x-domocode-client-id");
    return clientId !== null && session.clients.get(clientId)?.role === "authority" && session.clients.get(clientId)?.active === true;
  }

  private requireSession(id: string): MockSession {
    const session = this.sessionsById.get(id);
    if (!session) throw new Error(`Unknown mock session ${id}`);
    return session;
  }
}
