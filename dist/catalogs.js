import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.js";
/** Client-side view of the server-owned command, agent, model, and memory catalogs. */
export class CatalogClient {
    transport;
    modelCache;
    constructor(transport) {
        this.transport = transport;
    }
    async commands() {
        return decodeCommandRegistry(await this.transport.json("/commands"));
    }
    async agents() {
        return requiredArray(await this.transport.json("/agents"), "agents").map(decodeAgentProfileSummary);
    }
    async skills(options = {}) {
        const path = options.includeBody ? "/skills?include=body" : "/skills";
        return requiredArray(await this.transport.json(path), "skills").map(decodeSkillDescriptor);
    }
    async models(options = {}) {
        const maxAgeMs = options.maxAgeMs ?? 30_000;
        if (maxAgeMs > 0 && this.modelCache && this.modelCache.expiresAt > Date.now())
            return this.modelCache.value;
        const models = requiredArray(await this.transport.json("/models"), "models").map(decodeModelOption);
        if (maxAgeMs > 0)
            this.modelCache = { value: models, expiresAt: Date.now() + maxAgeMs };
        return models;
    }
    invalidateModels() { this.modelCache = undefined; }
    async memory() {
        return requiredArray(await this.transport.json("/memory"), "memory").map(decodeProjectMemoryRecord);
    }
    async snapshot(options = {}) {
        const [commands, agents, models, memory] = await Promise.all([this.commands(), this.agents(), this.models(options), this.memory()]);
        return { commands, agents, models, memory };
    }
}
export function decodeCommandRegistry(value) {
    if (!isRecord(value))
        throw new TypeError("Command registry must be an object");
    const commands = requiredArray(value.commands, "commands").map(decodeCommandDescriptor);
    return { ...value, commands };
}
export function decodeCommandDescriptor(value) {
    if (!isRecord(value))
        throw new TypeError("Command descriptor must be an object");
    return {
        ...value,
        name: requiredString(value.name, "command.name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "command.description") }),
        ...(value.argumentHint === undefined || value.argumentHint === null ? {} : { argumentHint: requiredString(value.argumentHint, "command.argumentHint") }),
        ...(value.kind === undefined || value.kind === null ? {} : { kind: requiredString(value.kind, "command.kind") }),
        ...(value.action === undefined || value.action === null ? {} : { action: requiredString(value.action, "command.action") }),
        ...(value.model === undefined || value.model === null ? {} : { model: requiredString(value.model, "command.model") }),
        ...(value.reasoningEffort === undefined || value.reasoningEffort === null ? {} : { reasoningEffort: requiredString(value.reasoningEffort, "command.reasoningEffort") }),
        ...(value.keywords === undefined || value.keywords === null ? {} : { keywords: requiredArray(value.keywords, "command.keywords").map((item) => requiredString(item, "command keyword")) }),
        ...(value.source === undefined || value.source === null ? {} : { source: requiredString(value.source, "command.source") })
    };
}
export function decodeAgentProfileSummary(value) {
    if (!isRecord(value))
        throw new TypeError("Agent profile summary must be an object");
    return {
        ...value,
        name: requiredString(value.name, "agent.name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "agent.description") }),
        mode: requiredString(value.mode, "agent.mode"),
        source: requiredString(value.source, "agent.source")
    };
}
export function decodeSkillDescriptor(value) {
    if (!isRecord(value))
        throw new TypeError("Skill descriptor must be an object");
    return {
        ...value,
        name: requiredString(value.name, "skill.name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "skill.description") }),
        keywords: value.keywords === undefined || value.keywords === null ? [] : requiredArray(value.keywords, "skill.keywords").map((item) => requiredString(item, "skill keyword")),
        ...(value.argumentHint === undefined || value.argumentHint === null ? {} : { argumentHint: requiredString(value.argumentHint, "skill.argumentHint") }),
        disableModelInvocation: requiredBoolean(value.disableModelInvocation, "skill.disableModelInvocation"),
        ...(value.toolAllowlist === undefined || value.toolAllowlist === null ? {} : { toolAllowlist: requiredArray(value.toolAllowlist, "skill.toolAllowlist").map((item) => requiredString(item, "skill tool allow-list entry")) }),
        source: requiredString(value.source, "skill.source"),
        ...(value.body === undefined || value.body === null ? {} : { body: requiredString(value.body, "skill.body") })
    };
}
export function decodeModelOption(value) {
    if (!isRecord(value))
        throw new TypeError("Model option must be an object");
    return {
        ...value,
        id: requiredString(value.id, "model.id"),
        ...(value.provider === undefined || value.provider === null ? {} : { provider: requiredString(value.provider, "model.provider") }),
        ...(value.contextWindow === undefined || value.contextWindow === null ? {} : { contextWindow: requiredNumber(value.contextWindow, "model.contextWindow") })
    };
}
export function decodeProjectMemoryRecord(value) {
    if (!isRecord(value))
        throw new TypeError("Project memory record must be an object");
    return {
        id: requiredString(value.id, "memory.id"),
        kind: requiredString(value.kind, "memory.kind"),
        title: requiredString(value.title, "memory.title"),
        content: requiredString(value.content, "memory.content"),
        createdAt: requiredString(value.createdAt, "memory.createdAt"),
        updatedAt: requiredString(value.updatedAt, "memory.updatedAt"),
        ...(value.sourceSessionID === undefined || value.sourceSessionID === null ? {} : { sourceSessionID: requiredString(value.sourceSessionID, "memory.sourceSessionID") }),
        tags: value.tags === undefined || value.tags === null ? [] : requiredArray(value.tags, "memory.tags").map((item) => requiredString(item, "memory tag"))
    };
}
export function decodeToolCatalogEntry(value) {
    if (!isRecord(value))
        throw new TypeError("Tool catalog entry must be an object");
    const inputSchema = value.inputSchema;
    if (!isRecord(inputSchema))
        throw new TypeError("Tool catalog inputSchema must be an object");
    return {
        ...value,
        name: requiredString(value.name, "tool.name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "tool.description") }),
        source: requiredString(value.source, "tool.source"),
        inputSchema,
        ...(value.permission === undefined || value.permission === null ? {} : { permission: requiredString(value.permission, "tool.permission") }),
        ...(value.hiddenReason === undefined || value.hiddenReason === null ? {} : { hiddenReason: requiredString(value.hiddenReason, "tool.hiddenReason") }),
        ...(value.metadata === undefined || value.metadata === null ? {} : { metadata: isRecord(value.metadata) ? value.metadata : {} })
    };
}
export function decodeToolCatalog(value) {
    return requiredArray(value, "tools").map(decodeToolCatalogEntry);
}
export function filterToolCatalog(tools, filter = {}) {
    return tools.filter((tool) => {
        if (filter.source !== undefined && tool.source !== filter.source)
            return false;
        if (filter.permission !== undefined && tool.permission !== filter.permission)
            return false;
        if (filter.mcpServer !== undefined && tool.metadata?.mcpServer !== filter.mcpServer)
            return false;
        if (filter.mcpTransport !== undefined && tool.metadata?.mcpTransport !== filter.mcpTransport)
            return false;
        if (!filter.includeHidden && tool.hiddenReason !== undefined)
            return false;
        return true;
    });
}
export function decodeMemoryRecords(value) {
    return requiredArray(value, "memory").map(decodeProjectMemoryRecord);
}
//# sourceMappingURL=catalogs.js.map