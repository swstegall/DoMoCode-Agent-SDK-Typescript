import { InteractionRuntime, type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
import type { SessionHandle } from "./session.ts";
import type { SubagentTaskEvent, SubagentStatus } from "./types/events.ts";

export interface SubagentRecord {
  taskId: string;
  childSessionId: string;
  parentSessionId?: string;
  depth: number;
  status: SubagentStatus;
  description?: string;
  prompt?: string;
  agent?: string;
  mode?: string;
  model?: string;
  toolAllowlist?: string[];
  output?: string;
  error?: string;
}

export interface SubagentRegistryOptions {
  /** Open each child stream. Enabled by default; authority preference controls answering. */
  observeChildren?: boolean;
  /** Authority preference for child answers. `prefer` can answer when no other client owns the child. */
  childAuthority?: "prefer" | "observer" | "require";
  interactions?: InteractionRuntimeOptions;
  warn?: (message: string) => void;
}

/** Live parent-to-child task index with child-stream interaction safety. */
export class SubagentRegistry {
  readonly ready: Promise<void>;
  private readonly recordsByTask = new Map<string, SubagentRecord>();
  private readonly childrenByTask = new Map<string, SessionHandle>();
  private readonly listeners = new Set<(record: SubagentRecord) => void>();
  private readonly interactionRuntime: InteractionRuntime;
  private readonly unsubscribeParent: () => void;
  private closed = false;
  private readonly options: SubagentRegistryOptions;

  constructor(private readonly parent: SessionHandle, options: SubagentRegistryOptions = {}) {
    this.options = options;
    this.interactionRuntime = new InteractionRuntime(options.interactions);
    this.unsubscribeParent = parent.onEvent((event) => {
      if (event.type === "subagent" && "subagent" in event) this.accept(event.subagent);
    });
    this.ready = this.interactionRuntime.attach(parent).then(() => undefined);
  }

  snapshot(): SubagentRecord[] { return [...this.recordsByTask.values()].map(copyRecord); }

  get(taskId: string): SubagentRecord | undefined {
    const record = this.recordsByTask.get(taskId);
    return record ? copyRecord(record) : undefined;
  }

  child(taskId: string): SessionHandle | undefined { return this.childrenByTask.get(taskId); }

  onUpdate(listener: (record: SubagentRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  interactions(): AsyncIterableIterator<RuntimeInteraction> { return this.interactionRuntime.interactions(); }

  onInteraction(handler: InteractionHandler): () => void { return this.interactionRuntime.onInteraction(handler); }

  pendingInteractions(): RuntimeInteraction[] { return this.interactionRuntime.pending(); }

  async openChild(taskId: string): Promise<SessionHandle | undefined> {
    const record = this.recordsByTask.get(taskId);
    if (!record || this.closed) return undefined;
    return this.observeChild(record);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeParent();
    this.interactionRuntime.close();
    const children = [...this.childrenByTask.values()];
    this.childrenByTask.clear();
    await Promise.all(children.map((child) => child.dispose().catch(() => undefined)));
  }

  private accept(event: SubagentTaskEvent): void {
    if (this.closed) return;
    const record: SubagentRecord = {
      taskId: event.taskId,
      childSessionId: event.childSessionId,
      depth: event.depth,
      status: event.status,
      ...(event.parentSessionId === undefined ? {} : { parentSessionId: event.parentSessionId }),
      ...(event.description === undefined ? {} : { description: event.description }),
      ...(event.prompt === undefined ? {} : { prompt: event.prompt }),
      ...(event.agent === undefined ? {} : { agent: event.agent }),
      ...(event.mode === undefined ? {} : { mode: event.mode }),
      ...(event.model === undefined ? {} : { model: event.model }),
      ...(event.toolAllowlist === undefined ? {} : { toolAllowlist: [...event.toolAllowlist] }),
      ...(event.output === undefined ? {} : { output: event.output }),
      ...(event.error === undefined ? {} : { error: event.error })
    };
    this.recordsByTask.set(record.taskId, record);
    const copied = copyRecord(record);
    for (const listener of this.listeners) listener(copied);
    if (this.options.observeChildren !== false && ["started", "accepted", "running"].includes(record.status)) void this.observeChild(record);
  }

  private async observeChild(record: SubagentRecord): Promise<SessionHandle | undefined> {
    const existing = this.childrenByTask.get(record.taskId);
    if (existing) return existing;
    try {
      const child = await this.parent.client.sessions.open(record.childSessionId, { authority: this.options.childAuthority ?? "prefer" });
      if (this.closed) {
        await child.dispose();
        return undefined;
      }
      this.childrenByTask.set(record.taskId, child);
      await this.interactionRuntime.attach(child);
      return child;
    } catch (error) {
      this.options.warn?.(`DoMoCode child session ${record.childSessionId} could not be observed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}

function copyRecord(record: SubagentRecord): SubagentRecord {
  return { ...record, ...(record.toolAllowlist === undefined ? {} : { toolAllowlist: [...record.toolAllowlist] }) };
}
