import type { JSONValue, OpenEnum } from "./common.ts";

export type CatalogSource = OpenEnum<"builtIn" | "mcp" | "adapter" | "extensionProvider">;
export type PromptResourceSource = OpenEnum<"builtin" | "user" | "project" | "mcp">;
export type CommandKind = OpenEnum<"local" | "prompt">;
export type ToolPermissionState = OpenEnum<"allowed" | "requiresApproval" | "denied" | "unavailable">;

export interface ToolCatalogFilter {
  source?: CatalogSource;
  mcpServer?: string;
  mcpTransport?: string;
  permission?: ToolPermissionState;
  includeHidden?: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  description?: string;
  source: CatalogSource;
  inputSchema: Record<string, unknown>;
  permission?: ToolPermissionState;
  hiddenReason?: string;
  metadata?: Record<string, JSONValue>;
  [key: string]: unknown;
}

export interface CommandDescriptor {
  name: string;
  description?: string;
  argumentHint?: string;
  kind?: CommandKind;
  action?: OpenEnum<string>;
  model?: string;
  reasoningEffort?: OpenEnum<string>;
  keywords?: string[];
  source?: PromptResourceSource;
  [key: string]: unknown;
}

export interface CommandRegistry { commands: CommandDescriptor[]; [key: string]: unknown }
export interface AgentProfileSummary { name: string; description?: string; mode: string; source: PromptResourceSource }
export interface ModelOption { id: string; provider?: string; contextWindow?: number; [key: string]: unknown }
export type ProjectMemoryKind = OpenEnum<"project" | "environment" | "correction" | "sessionDigest">;
export interface ProjectMemoryRecord { id: string; kind: ProjectMemoryKind; title: string; content: string; createdAt: string; updatedAt: string; sourceSessionID?: string; tags: string[] }
export type MemoryRecord = ProjectMemoryRecord;
export interface CatalogSnapshot { tools: ToolCatalogEntry[]; commands: CommandDescriptor[]; skills: CommandDescriptor[]; agents: AgentProfileSummary[]; models: ModelOption[] }
