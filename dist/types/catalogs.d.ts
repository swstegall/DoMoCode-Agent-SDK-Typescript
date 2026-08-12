import type { JSONValue, OpenEnum } from "./common.ts";
export type CatalogSource = OpenEnum<"builtIn" | "mcp" | "adapter" | "extensionProvider">;
export interface ToolCatalogEntry {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    source: CatalogSource;
    metadata?: Record<string, JSONValue>;
    [key: string]: unknown;
}
export interface CommandDescriptor {
    name: string;
    description?: string;
    argumentHint?: string;
    source: CatalogSource;
    [key: string]: unknown;
}
export interface CommandRegistry {
    commands: CommandDescriptor[];
    [key: string]: unknown;
}
export interface AgentProfileSummary {
    name: string;
    description?: string;
    mode: string;
    source: CatalogSource;
}
export interface ModelOption {
    id: string;
    provider?: string;
    contextWindow?: number;
    [key: string]: unknown;
}
export interface MemoryRecord {
    [key: string]: unknown;
}
export interface CatalogSnapshot {
    tools: ToolCatalogEntry[];
    commands: CommandDescriptor[];
    skills: CommandDescriptor[];
    agents: AgentProfileSummary[];
    models: ModelOption[];
}
//# sourceMappingURL=catalogs.d.ts.map