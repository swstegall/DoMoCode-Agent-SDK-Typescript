import type { Transport } from "./transport.ts";
import type { AgentProfileSummary, CommandDescriptor, CommandRegistry, MemoryRecord, ModelOption, ProjectMemoryRecord, SkillDescriptor, ToolCatalogEntry, ToolCatalogFilter } from "./types/catalogs.ts";
export interface ModelCatalogOptions {
    maxAgeMs?: number;
}
export interface SkillCatalogOptions {
    includeBody?: boolean;
}
/** Client-side view of the server-owned command, agent, model, and memory catalogs. */
export declare class CatalogClient {
    private readonly transport;
    private modelCache;
    constructor(transport: Transport);
    commands(): Promise<CommandRegistry>;
    agents(): Promise<AgentProfileSummary[]>;
    skills(options?: SkillCatalogOptions): Promise<SkillDescriptor[]>;
    models(options?: ModelCatalogOptions): Promise<ModelOption[]>;
    invalidateModels(): void;
    memory(): Promise<ProjectMemoryRecord[]>;
    snapshot(options?: ModelCatalogOptions): Promise<{
        commands: CommandRegistry;
        skills: SkillDescriptor[];
        agents: AgentProfileSummary[];
        models: ModelOption[];
        memory: ProjectMemoryRecord[];
    }>;
}
export declare function decodeCommandRegistry(value: unknown): CommandRegistry;
export declare function decodeCommandDescriptor(value: unknown): CommandDescriptor;
export declare function decodeAgentProfileSummary(value: unknown): AgentProfileSummary;
export declare function decodeSkillDescriptor(value: unknown): SkillDescriptor;
export declare function decodeModelOption(value: unknown): ModelOption;
export declare function decodeProjectMemoryRecord(value: unknown): ProjectMemoryRecord;
export declare function decodeToolCatalogEntry(value: unknown): ToolCatalogEntry;
export declare function decodeToolCatalog(value: unknown): ToolCatalogEntry[];
export declare function filterToolCatalog(tools: readonly ToolCatalogEntry[], filter?: ToolCatalogFilter): ToolCatalogEntry[];
export declare function decodeMemoryRecords(value: unknown): MemoryRecord[];
//# sourceMappingURL=catalogs.d.ts.map