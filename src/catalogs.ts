import type { Transport } from "./transport.ts";
import { isRecord, requiredArray, requiredNumber, requiredString } from "./types/common.ts";
import type { AgentProfileSummary, CatalogSource, CommandDescriptor, CommandKind, CommandRegistry, MemoryRecord, ModelOption, ProjectMemoryRecord, PromptResourceSource, ToolCatalogEntry, ToolPermissionState } from "./types/catalogs.ts";

export interface ModelCatalogOptions { maxAgeMs?: number }

/** Client-side view of the server-owned command, agent, model, and memory catalogs. */
export class CatalogClient {
  private modelCache: { value: ModelOption[]; expiresAt: number } | undefined;

  constructor(private readonly transport: Transport) {}

  async commands(): Promise<CommandRegistry> {
    return decodeCommandRegistry(await this.transport.json<unknown>("/commands"));
  }

  async agents(): Promise<AgentProfileSummary[]> {
    return requiredArray(await this.transport.json<unknown>("/agents"), "agents").map(decodeAgentProfileSummary);
  }

  async models(options: ModelCatalogOptions = {}): Promise<ModelOption[]> {
    const maxAgeMs = options.maxAgeMs ?? 30_000;
    if (maxAgeMs > 0 && this.modelCache && this.modelCache.expiresAt > Date.now()) return this.modelCache.value;
    const models = requiredArray(await this.transport.json<unknown>("/models"), "models").map(decodeModelOption);
    if (maxAgeMs > 0) this.modelCache = { value: models, expiresAt: Date.now() + maxAgeMs };
    return models;
  }

  invalidateModels(): void { this.modelCache = undefined; }

  async memory(): Promise<ProjectMemoryRecord[]> {
    return requiredArray(await this.transport.json<unknown>("/memory"), "memory").map(decodeProjectMemoryRecord);
  }

  async snapshot(options: ModelCatalogOptions = {}): Promise<{ commands: CommandRegistry; agents: AgentProfileSummary[]; models: ModelOption[]; memory: ProjectMemoryRecord[] }> {
    const [commands, agents, models, memory] = await Promise.all([this.commands(), this.agents(), this.models(options), this.memory()]);
    return { commands, agents, models, memory };
  }
}

export function decodeCommandRegistry(value: unknown): CommandRegistry {
  if (!isRecord(value)) throw new TypeError("Command registry must be an object");
  const commands = requiredArray(value.commands, "commands").map(decodeCommandDescriptor);
  return { ...value, commands };
}

export function decodeCommandDescriptor(value: unknown): CommandDescriptor {
  if (!isRecord(value)) throw new TypeError("Command descriptor must be an object");
  return {
    ...value,
    name: requiredString(value.name, "command.name"),
    ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "command.description") }),
    ...(value.argumentHint === undefined || value.argumentHint === null ? {} : { argumentHint: requiredString(value.argumentHint, "command.argumentHint") }),
    ...(value.kind === undefined || value.kind === null ? {} : { kind: requiredString(value.kind, "command.kind") as CommandKind }),
    ...(value.action === undefined || value.action === null ? {} : { action: requiredString(value.action, "command.action") }),
    ...(value.model === undefined || value.model === null ? {} : { model: requiredString(value.model, "command.model") }),
    ...(value.reasoningEffort === undefined || value.reasoningEffort === null ? {} : { reasoningEffort: requiredString(value.reasoningEffort, "command.reasoningEffort") }),
    ...(value.keywords === undefined || value.keywords === null ? {} : { keywords: requiredArray(value.keywords, "command.keywords").map((item) => requiredString(item, "command keyword")) }),
    ...(value.source === undefined || value.source === null ? {} : { source: requiredString(value.source, "command.source") as PromptResourceSource })
  };
}

export function decodeAgentProfileSummary(value: unknown): AgentProfileSummary {
  if (!isRecord(value)) throw new TypeError("Agent profile summary must be an object");
  return {
    ...value,
    name: requiredString(value.name, "agent.name"),
    ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "agent.description") }),
    mode: requiredString(value.mode, "agent.mode"),
    source: requiredString(value.source, "agent.source") as PromptResourceSource
  };
}

export function decodeModelOption(value: unknown): ModelOption {
  if (!isRecord(value)) throw new TypeError("Model option must be an object");
  return {
    ...value,
    id: requiredString(value.id, "model.id"),
    ...(value.provider === undefined || value.provider === null ? {} : { provider: requiredString(value.provider, "model.provider") }),
    ...(value.contextWindow === undefined || value.contextWindow === null ? {} : { contextWindow: requiredNumber(value.contextWindow, "model.contextWindow") })
  };
}

export function decodeProjectMemoryRecord(value: unknown): ProjectMemoryRecord {
  if (!isRecord(value)) throw new TypeError("Project memory record must be an object");
  return {
    id: requiredString(value.id, "memory.id"),
    kind: requiredString(value.kind, "memory.kind") as ProjectMemoryRecord["kind"],
    title: requiredString(value.title, "memory.title"),
    content: requiredString(value.content, "memory.content"),
    createdAt: requiredString(value.createdAt, "memory.createdAt"),
    updatedAt: requiredString(value.updatedAt, "memory.updatedAt"),
    ...(value.sourceSessionID === undefined || value.sourceSessionID === null ? {} : { sourceSessionID: requiredString(value.sourceSessionID, "memory.sourceSessionID") }),
    tags: value.tags === undefined || value.tags === null ? [] : requiredArray(value.tags, "memory.tags").map((item) => requiredString(item, "memory tag"))
  };
}

export function decodeToolCatalogEntry(value: unknown): ToolCatalogEntry {
  if (!isRecord(value)) throw new TypeError("Tool catalog entry must be an object");
  const inputSchema = value.inputSchema;
  if (!isRecord(inputSchema)) throw new TypeError("Tool catalog inputSchema must be an object");
  return {
    ...value,
    name: requiredString(value.name, "tool.name"),
    ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "tool.description") }),
    source: requiredString(value.source, "tool.source") as CatalogSource,
    inputSchema,
    ...(value.permission === undefined || value.permission === null ? {} : { permission: requiredString(value.permission, "tool.permission") as ToolPermissionState }),
    ...(value.hiddenReason === undefined || value.hiddenReason === null ? {} : { hiddenReason: requiredString(value.hiddenReason, "tool.hiddenReason") }),
    ...(value.metadata === undefined || value.metadata === null ? {} : { metadata: isRecord(value.metadata) ? value.metadata as NonNullable<ToolCatalogEntry["metadata"]> : {} })
  };
}

export function decodeToolCatalog(value: unknown): ToolCatalogEntry[] {
  return requiredArray(value, "tools").map(decodeToolCatalogEntry);
}

export function decodeMemoryRecords(value: unknown): MemoryRecord[] {
  return requiredArray(value, "memory").map(decodeProjectMemoryRecord);
}
