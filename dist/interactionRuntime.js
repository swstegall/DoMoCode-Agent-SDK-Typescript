import { isRecord } from "./types/common.js";
import { PermissionGrantError } from "./types/errors.js";
/**
 * A single-consumer queue for interaction asks. A consumer claims an ask when
 * `next()` hands it over, which gives iterator consumers precedence over the
 * policy tier without requiring a second event stream.
 */
class AskQueue {
    onClaim;
    values = [];
    waiters = [];
    closed = false;
    constructor(onClaim) {
        this.onClaim = onClaim;
    }
    get hasWaiter() { return this.waiters.length > 0; }
    push(value) {
        if (this.closed)
            return;
        const waiter = this.waiters.shift();
        if (waiter) {
            this.onClaim(value);
            waiter.resolve({ value, done: false });
        }
        else {
            this.values.push(value);
        }
    }
    remove(predicate) {
        for (let index = this.values.length - 1; index >= 0; index -= 1)
            if (predicate(this.values[index]))
                this.values.splice(index, 1);
    }
    close() {
        this.closed = true;
        while (this.waiters.length > 0)
            this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
    next() {
        const value = this.values.shift();
        if (value) {
            this.onClaim(value);
            return Promise.resolve({ value, done: false });
        }
        if (this.closed)
            return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
    async return() {
        this.close();
        return { value: undefined, done: true };
    }
    [Symbol.asyncIterator]() { return this; }
}
/** Interaction registry and dispatcher for one or more session streams. */
export class InteractionRuntime {
    entries = new Map();
    controllers = new Map();
    handlers = [];
    queue;
    unsubs = new Map();
    dispatching = new Set();
    options;
    constructor(options = {}) {
        this.options = {
            allowPersistentGrants: options.allowPersistentGrants ?? false,
            warn: options.warn ?? ((message) => console.warn(message)),
            idleMs: options.idleMs ?? 5_000,
            ...(options.policy === undefined ? {} : { policy: options.policy })
        };
        this.queue = new AskQueue((interaction) => this.claim(interaction));
    }
    /** Subscribe to a session and hydrate asks that predate the subscription. */
    async attach(session) {
        const key = session.id;
        this.unsubs.get(key)?.();
        const unsubscribe = session.onEvent((event) => this.accept(session, event));
        this.unsubs.set(key, unsubscribe);
        const pending = await Promise.all([
            session.pendingPermissions().catch(() => []),
            session.pendingQuestions().catch(() => [])
        ]);
        for (const event of pending.flat())
            this.accept(session, event);
        return () => {
            unsubscribe();
            if (this.unsubs.get(key) === unsubscribe)
                this.unsubs.delete(key);
        };
    }
    pending() { return [...this.entries.values()].map((entry) => entry.interaction); }
    interactions() { return this.queue; }
    /** Add an explicit handler. Newer handlers run first. */
    onInteraction(handler) {
        this.handlers.push(handler);
        return () => {
            const index = this.handlers.lastIndexOf(handler);
            if (index >= 0)
                this.handlers.splice(index, 1);
        };
    }
    close() {
        for (const unsubscribe of this.unsubs.values())
            unsubscribe();
        this.unsubs.clear();
        this.queue.close();
        for (const controller of this.controllers.values())
            controller.abort();
        this.controllers.clear();
        this.entries.clear();
    }
    accept(session, event) {
        if ((event.type === "permission_resolved" || event.type === "question_resolved") && "id" in event) {
            this.resolve(event.type === "permission_resolved" ? "permission" : "question", event.id, session.id);
            return;
        }
        let interaction;
        if (event.type === "permission_request" && "id" in event)
            interaction = this.permission(session, event);
        else if (event.type === "question_request" && "id" in event)
            interaction = this.question(session, event);
        else if (event.type.endsWith("_request") && "raw" in event && isRecord(event.raw) && typeof event.raw.id === "string") {
            interaction = this.unknown(session, event.type.slice(0, -"_request".length), event.raw.id, event.raw);
        }
        if (!interaction)
            return;
        const key = this.key(interaction.kind, interaction.id, interaction.sessionId);
        const previous = this.entries.get(key);
        if (previous)
            this.queue.remove((value) => value === previous.interaction);
        this.controllers.get(key)?.abort();
        const controller = new AbortController();
        const withSignal = { ...interaction, signal: controller.signal };
        const entry = { interaction: withSignal, controller, claimed: false };
        this.controllers.set(key, controller);
        this.entries.set(key, entry);
        this.queue.push(withSignal);
        void this.dispatch(session, key, entry);
    }
    claim(interaction) {
        const entry = this.entries.get(this.key(interaction.kind, interaction.id, interaction.sessionId));
        if (entry)
            entry.claimed = true;
    }
    async dispatch(session, key, entry) {
        if (this.dispatching.has(key))
            return;
        this.dispatching.add(key);
        try {
            // Let an already-waiting iterator claim the ask before invoking handlers.
            await Promise.resolve();
            if (!this.isPending(key, entry) || entry.claimed)
                return;
            for (const handler of [...this.handlers].reverse()) {
                if (!this.isPending(key, entry))
                    return;
                let declined = false;
                const wrapped = { ...entry.interaction, decline: () => { declined = true; } };
                try {
                    const result = await handler(wrapped);
                    if (!this.isPending(key, entry))
                        return;
                    if (!declined && result !== "decline") {
                        entry.claimed = true;
                        return;
                    }
                }
                catch (error) {
                    this.options.warn(`DoMoCode interaction handler failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            // If an iterator was already waiting, give it a chance to claim before policy.
            if (!entry.claimed && this.queue.hasWaiter) {
                await this.waitForClaim(entry, key);
                if (!this.isPending(key, entry) || entry.claimed)
                    return;
            }
            const policy = this.options.policy;
            if (isPermissionAsk(entry.interaction) && policy?.permission) {
                entry.claimed = true;
                await policy.permission(entry.interaction);
            }
            else if (isQuestionAsk(entry.interaction) && policy?.question) {
                entry.claimed = true;
                await policy.question(entry.interaction);
            }
            else {
                this.warnUnhandled(entry.interaction);
            }
            if (this.isPending(key, entry)) {
                if (policy && !isUnknownAsk(entry.interaction))
                    this.options.warn(`DoMoCode policy left interaction ${entry.interaction.id} unanswered.`);
                this.warnStillPending(entry.interaction);
            }
        }
        catch (error) {
            this.options.warn(`DoMoCode interaction policy failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            this.dispatching.delete(key);
        }
        void session;
    }
    async waitForClaim(entry, key) {
        if (entry.claimed || this.options.idleMs < 0)
            return;
        await new Promise((resolve) => {
            let timer;
            const poll = setInterval(() => {
                if (!this.isPending(key, entry) || entry.claimed) {
                    clearInterval(poll);
                    if (timer !== undefined)
                        clearTimeout(timer);
                    resolve();
                }
            }, 10);
            timer = setTimeout(() => { clearInterval(poll); resolve(); }, this.options.idleMs);
        });
    }
    warnUnhandled(interaction) {
        this.options.warn(`Unhandled DoMoCode ${interaction.kind} interaction ${interaction.id}; the run may stall.`);
    }
    warnStillPending(interaction) {
        if (this.options.idleMs < 0)
            return;
        setTimeout(() => {
            if (this.entries.has(this.key(interaction.kind, interaction.id, interaction.sessionId)))
                this.options.warn(`DoMoCode interaction ${interaction.id} is still unanswered.`);
        }, this.options.idleMs);
    }
    permission(session, event) {
        const allow = async (options = {}) => {
            if (options.always && (event.disableAlways || !this.options.allowPersistentGrants))
                throw new PermissionGrantError();
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
    question(session, event) {
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
    unknown(session, kind, id, raw) {
        const sessionId = isRecord(raw) && typeof raw.sessionId === "string" ? raw.sessionId : session.id;
        return { kind, id, sessionId, raw, signal: new AbortController().signal, decline: () => undefined };
    }
    resolve(kind, id, sessionId) {
        const key = this.key(kind, id, sessionId);
        const entry = this.entries.get(key);
        if (entry)
            this.queue.remove((value) => value === entry.interaction);
        this.controllers.get(key)?.abort();
        this.controllers.delete(key);
        this.entries.delete(key);
    }
    isPending(key, entry) { return this.entries.get(key) === entry; }
    key(kind, id, sessionId) { return `${sessionId ?? ""}:${kind}:${id}`; }
}
export function permissionPolicy(options = {}) {
    const rules = options.rules ?? [];
    const fallback = options.default ?? "ask";
    return {
        permission: async (ask) => {
            let action = fallback;
            const subject = ask.metadata.command ?? ask.metadata.filepath ?? ask.metadata.filepaths ?? ask.patterns[0] ?? ask.permission;
            for (const rule of rules)
                if (wildcardMatch(rule.pattern, String(subject)))
                    action = rule.action;
            if (action === "allow")
                await ask.allow();
            else if (action === "deny")
                await ask.deny("Denied by SDK permission policy.");
            else if (options.timeout) {
                const timeout = options.timeout;
                await delayUnlessAborted(timeout.after, ask.signal);
                if (!ask.signal.aborted) {
                    if (timeout.action === "allow")
                        await ask.allow();
                    else
                        await ask.deny("Permission policy timed out.");
                }
            }
        },
        question: async (ask) => {
            if (options.timeout) {
                await delayUnlessAborted(options.timeout.after, ask.signal);
                if (!ask.signal.aborted)
                    await ask.cancel();
            }
        }
    };
}
export function yolo() {
    return {
        permission: (ask) => ask.allow(),
        question: (ask) => ask.answer(ask.questions.map((question) => ({ selectedLabels: question.options.map((option) => option.label) })))
    };
}
export function wildcardMatch(pattern, value) {
    let expression = "^";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === undefined)
            break;
        if (character === "*" && pattern[index + 1] === "*") {
            expression += ".*";
            index += 1;
        }
        else if (character === "*")
            expression += "[^/]*";
        else if (character === "?")
            expression += "[^/]";
        else
            expression += /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
    }
    return new RegExp(`${expression}$`).test(value);
}
function isPermissionAsk(ask) {
    return ask.kind === "permission" && "allow" in ask && typeof ask.allow === "function";
}
function isQuestionAsk(ask) {
    return ask.kind === "question" && "answer" in ask && typeof ask.answer === "function";
}
function isUnknownAsk(ask) {
    return !isPermissionAsk(ask) && !isQuestionAsk(ask);
}
function delayUnlessAborted(milliseconds, signal) {
    if (signal.aborted || milliseconds <= 0)
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}
//# sourceMappingURL=interactionRuntime.js.map