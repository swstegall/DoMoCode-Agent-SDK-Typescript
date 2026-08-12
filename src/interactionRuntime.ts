import type { PermissionRequest, QuestionAnswer, QuestionPrompt } from "./types/asks.ts";
import type { ServerEvent } from "./types/events.ts";
import { isRecord } from "./types/common.ts";
import { PermissionGrantError } from "./types/errors.ts";
import type { SessionHandle } from "./session.ts";

export type Decline = "decline";
export type InteractionHandler = (ask: RuntimeInteraction) => Promise<void | Decline> | void | Decline;

export interface PermissionAsk extends PermissionRequest {
  kind: "permission";
  signal: AbortSignal;
  allow(options?: { always?: boolean }): Promise<void>;
  deny(message?: string): Promise<void>;
  decline(): void;
}

export interface QuestionAsk {
  kind: "question";
  id: string;
  sessionId: string;
  questions: QuestionPrompt[];
  signal: AbortSignal;
  answer(answers: QuestionAnswer[]): Promise<void>;
  cancel(): Promise<void>;
  decline(): void;
}

export interface UnknownAsk {
  kind: string;
  id: string;
  sessionId?: string;
  raw: unknown;
  signal: AbortSignal;
  decline(): void;
}

export type RuntimeInteraction = PermissionAsk | QuestionAsk | UnknownAsk;

export interface PermissionPolicyOptions {
  rules?: Array<{ pattern: string; action: "allow" | "deny" | "ask" }>;
  default?: "allow" | "deny" | "ask";
  timeout?: { after: number; action: "allow" | "deny" };
}

export interface InteractionPolicy {
  permission?: (ask: PermissionAsk) => Promise<void>;
  question?: (ask: QuestionAsk) => Promise<void>;
}

export interface InteractionRuntimeOptions {
  /** Permit `ask.allow({always: true})`, which writes a durable server rule. */
  allowPersistentGrants?: boolean;
  /** Receives warnings for unhandled or stalled interactions. */
  warn?: (message: string) => void;
  /** Time before an unanswered interaction receives its second warning. */
  idleMs?: number;
  /** Fallback policy used after explicit handlers and iterators decline an ask. */
  policy?: InteractionPolicy;
}

interface AskQueueWaiter {
  resolve: (result: IteratorResult<RuntimeInteraction>) => void;
  reject: (reason: unknown) => void;
}

interface PendingEntry {
  interaction: RuntimeInteraction;
  controller: AbortController;
  claimed: boolean;
}

/**
 * A single-consumer queue for interaction asks. A consumer claims an ask when
 * `next()` hands it over, which gives iterator consumers precedence over the
 * policy tier without requiring a second event stream.
 */
class AskQueue implements AsyncIterableIterator<RuntimeInteraction> {
  private readonly values: RuntimeInteraction[] = [];
  private readonly waiters: AskQueueWaiter[] = [];
  private closed = false;

  constructor(private readonly onClaim: (value: RuntimeInteraction) => void) {}

  get hasWaiter(): boolean { return this.waiters.length > 0; }

  push(value: RuntimeInteraction): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      this.onClaim(value);
      waiter.resolve({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  remove(predicate: (value: RuntimeInteraction) => boolean): void {
    for (let index = this.values.length - 1; index >= 0; index -= 1) if (predicate(this.values[index]!)) this.values.splice(index, 1);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.resolve({ value: undefined as never, done: true });
  }

  next(): Promise<IteratorResult<RuntimeInteraction>> {
    const value = this.values.shift();
    if (value) {
      this.onClaim(value);
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async return(): Promise<IteratorResult<RuntimeInteraction>> {
    this.close();
    return { value: undefined as never, done: true };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<RuntimeInteraction> { return this; }
}

/** Interaction registry and dispatcher for one or more session streams. */
export class InteractionRuntime {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly handlers: InteractionHandler[] = [];
  private readonly queue: AskQueue;
  private readonly unsubs = new Map<string, () => void>();
  private readonly dispatching = new Set<string>();
  private readonly options: {
    allowPersistentGrants: boolean;
    warn: (message: string) => void;
    idleMs: number;
    policy?: InteractionPolicy;
  };

  constructor(options: InteractionRuntimeOptions = {}) {
    this.options = {
      allowPersistentGrants: options.allowPersistentGrants ?? false,
      warn: options.warn ?? ((message) => console.warn(message)),
      idleMs: options.idleMs ?? 5_000,
      ...(options.policy === undefined ? {} : { policy: options.policy })
    };
    this.queue = new AskQueue((interaction) => this.claim(interaction));
  }

  /** Subscribe to a session and hydrate asks that predate the subscription. */
  async attach(session: SessionHandle): Promise<() => void> {
    const key = session.id;
    this.unsubs.get(key)?.();
    const unsubscribe = session.onEvent((event) => this.accept(session, event));
    this.unsubs.set(key, unsubscribe);
    const pending = await Promise.all([
      session.pendingPermissions().catch(() => []),
      session.pendingQuestions().catch(() => [])
    ]);
    for (const event of pending.flat()) this.accept(session, event);
    return () => {
      unsubscribe();
      if (this.unsubs.get(key) === unsubscribe) this.unsubs.delete(key);
    };
  }

  pending(): RuntimeInteraction[] { return [...this.entries.values()].map((entry) => entry.interaction); }

  interactions(): AsyncIterableIterator<RuntimeInteraction> { return this.queue; }

  /** Add an explicit handler. Newer handlers run first. */
  onInteraction(handler: InteractionHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.lastIndexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  close(): void {
    for (const unsubscribe of this.unsubs.values()) unsubscribe();
    this.unsubs.clear();
    this.queue.close();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.entries.clear();
  }

  private accept(session: SessionHandle, event: ServerEvent): void {
    if ((event.type === "permission_resolved" || event.type === "question_resolved") && "id" in event) {
      this.resolve(event.type === "permission_resolved" ? "permission" : "question", event.id, session.id);
      return;
    }

    let interaction: RuntimeInteraction | undefined;
    if (event.type === "permission_request" && "id" in event) interaction = this.permission(session, event);
    else if (event.type === "question_request" && "id" in event) interaction = this.question(session, event);
    else if (event.type.endsWith("_request") && "raw" in event && isRecord(event.raw) && typeof event.raw.id === "string") {
      interaction = this.unknown(session, event.type.slice(0, -"_request".length), event.raw.id, event.raw);
    }
    if (!interaction) return;

    const key = this.key(interaction.kind, interaction.id, interaction.sessionId);
    const previous = this.entries.get(key);
    if (previous) this.queue.remove((value) => value === previous.interaction);
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    const withSignal = { ...interaction, signal: controller.signal } as RuntimeInteraction;
    const entry = { interaction: withSignal, controller, claimed: false } satisfies PendingEntry;
    this.controllers.set(key, controller);
    this.entries.set(key, entry);
    this.queue.push(withSignal);
    void this.dispatch(session, key, entry);
  }

  private claim(interaction: RuntimeInteraction): void {
    const entry = this.entries.get(this.key(interaction.kind, interaction.id, interaction.sessionId));
    if (entry) entry.claimed = true;
  }

  private async dispatch(session: SessionHandle, key: string, entry: PendingEntry): Promise<void> {
    if (this.dispatching.has(key)) return;
    this.dispatching.add(key);
    try {
      // Let an already-waiting iterator claim the ask before invoking handlers.
      await Promise.resolve();
      if (!this.isPending(key, entry) || entry.claimed) return;

      for (const handler of [...this.handlers].reverse()) {
        if (!this.isPending(key, entry)) return;
        let declined = false;
        const wrapped = { ...entry.interaction, decline: () => { declined = true; } } as RuntimeInteraction;
        try {
          const result = await handler(wrapped);
          if (!this.isPending(key, entry)) return;
          if (!declined && result !== "decline") {
            entry.claimed = true;
            return;
          }
        } catch (error) {
          this.options.warn(`DoMoCode interaction handler failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // If an iterator was already waiting, give it a chance to claim before policy.
      if (!entry.claimed && this.queue.hasWaiter) {
        await this.waitForClaim(entry, key);
        if (!this.isPending(key, entry) || entry.claimed) return;
      }

      const policy = this.options.policy;
      if (isPermissionAsk(entry.interaction) && policy?.permission) {
        entry.claimed = true;
        await policy.permission(entry.interaction);
      } else if (isQuestionAsk(entry.interaction) && policy?.question) {
        entry.claimed = true;
        await policy.question(entry.interaction);
      } else {
        this.warnUnhandled(entry.interaction);
      }

      if (this.isPending(key, entry)) {
        if (policy && !isUnknownAsk(entry.interaction)) this.options.warn(`DoMoCode policy left interaction ${entry.interaction.id} unanswered.`);
        this.warnStillPending(entry.interaction);
      }
    } catch (error) {
      this.options.warn(`DoMoCode interaction policy failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.dispatching.delete(key);
    }
    void session;
  }

  private async waitForClaim(entry: PendingEntry, key: string): Promise<void> {
    if (entry.claimed || this.options.idleMs < 0) return;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = setInterval(() => {
        if (!this.isPending(key, entry) || entry.claimed) {
          clearInterval(poll);
          if (timer !== undefined) clearTimeout(timer);
          resolve();
        }
      }, 10);
      timer = setTimeout(() => { clearInterval(poll); resolve(); }, this.options.idleMs);
    });
  }

  private warnUnhandled(interaction: RuntimeInteraction): void {
    this.options.warn(`Unhandled DoMoCode ${interaction.kind} interaction ${interaction.id}; the run may stall.`);
  }

  private warnStillPending(interaction: RuntimeInteraction): void {
    if (this.options.idleMs < 0) return;
    setTimeout(() => {
      if (this.entries.has(this.key(interaction.kind, interaction.id, interaction.sessionId))) this.options.warn(`DoMoCode interaction ${interaction.id} is still unanswered.`);
    }, this.options.idleMs);
  }

  private permission(session: SessionHandle, event: Extract<ServerEvent, { type: "permission_request" }>): PermissionAsk {
    const allow = async (options: { always?: boolean } = {}): Promise<void> => {
      if (options.always && (event.disableAlways || !this.options.allowPersistentGrants)) throw new PermissionGrantError();
      await session.answerPermission(event.id, options.always ? "always" : "once");
    };
    return {
      kind: "permission",
      id: event.id,
      sessionId: event.sessionId,
      permission: event.permission,
      patterns: event.patterns,
      always: event.always,
      metadata: event.metadata,
      disableAlways: event.disableAlways,
      signal: new AbortController().signal,
      allow,
      deny: (message) => session.answerPermission(event.id, "reject", message),
      decline: () => undefined
    };
  }

  private question(session: SessionHandle, event: Extract<ServerEvent, { type: "question_request" }>): QuestionAsk {
    return {
      kind: "question",
      id: event.id,
      sessionId: event.sessionId,
      questions: event.questions,
      signal: new AbortController().signal,
      answer: (answers) => session.answerQuestion(event.id, answers),
      cancel: () => session.answerQuestion(event.id, null),
      decline: () => undefined
    };
  }

  private unknown(session: SessionHandle, kind: string, id: string, raw: unknown): UnknownAsk {
    const sessionId = isRecord(raw) && typeof raw.sessionId === "string" ? raw.sessionId : session.id;
    return { kind, id, sessionId, raw, signal: new AbortController().signal, decline: () => undefined };
  }

  private resolve(kind: string, id: string, sessionId: string): void {
    const key = this.key(kind, id, sessionId);
    const entry = this.entries.get(key);
    if (entry) this.queue.remove((value) => value === entry.interaction);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.entries.delete(key);
  }

  private isPending(key: string, entry: PendingEntry): boolean { return this.entries.get(key) === entry; }

  private key(kind: string, id: string, sessionId?: string): string { return `${sessionId ?? ""}:${kind}:${id}`; }
}

export function permissionPolicy(options: PermissionPolicyOptions = {}): InteractionPolicy {
  const rules = options.rules ?? [];
  const fallback = options.default ?? "ask";
  return {
    permission: async (ask) => {
      let action = fallback;
      const subject = ask.metadata.command ?? ask.metadata.filepath ?? ask.metadata.filepaths ?? ask.patterns[0] ?? ask.permission;
      for (const rule of rules) if (wildcardMatch(rule.pattern, String(subject))) action = rule.action;
      if (action === "allow") await ask.allow();
      else if (action === "deny") await ask.deny("Denied by SDK permission policy.");
      else if (options.timeout) {
        const timeout = options.timeout;
        await delayUnlessAborted(timeout.after, ask.signal);
        if (!ask.signal.aborted) {
          if (timeout.action === "allow") await ask.allow();
          else await ask.deny("Permission policy timed out.");
        }
      }
    },
    question: async (ask) => {
      if (options.timeout) {
        await delayUnlessAborted(options.timeout.after, ask.signal);
        if (!ask.signal.aborted) await ask.cancel();
      }
    }
  };
}

export function yolo(): InteractionPolicy {
  return {
    permission: (ask) => ask.allow(),
    question: (ask) => ask.answer(ask.questions.map((question) => ({ selectedLabels: question.options.map((option) => option.label) })))
  };
}

export function wildcardMatch(pattern: string, value: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) break;
    if (character === "*" && pattern[index + 1] === "*") { expression += ".*"; index += 1; }
    else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${expression}$`).test(value);
}

function isPermissionAsk(ask: RuntimeInteraction): ask is PermissionAsk {
  return ask.kind === "permission" && "allow" in ask && typeof ask.allow === "function";
}

function isQuestionAsk(ask: RuntimeInteraction): ask is QuestionAsk {
  return ask.kind === "question" && "answer" in ask && typeof ask.answer === "function";
}

function isUnknownAsk(ask: RuntimeInteraction): ask is UnknownAsk {
  return !isPermissionAsk(ask) && !isQuestionAsk(ask);
}

function delayUnlessAborted(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
