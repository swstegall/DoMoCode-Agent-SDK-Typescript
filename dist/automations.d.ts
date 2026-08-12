import { type CursorFeed } from "./cursorFeed.ts";
import { type Transport } from "./transport.ts";
import { type DurableRequestOptions } from "./durableSupport.ts";
import type { AutomationAuditEvent, AutomationDefinition, AutomationEvent, AutomationInvocation, AutomationJournalEntry } from "./types/durable.ts";
export interface AutomationListOptions extends DurableRequestOptions {
    owner?: string;
}
export interface AutomationFeedOptions extends DurableRequestOptions {
    after?: number;
    pollIntervalMs?: number;
}
/** REST and cursor-feed access to the policy and audit side of automations. */
export declare class AutomationClient {
    private readonly transport;
    constructor(transport: Transport);
    list(options?: AutomationListOptions): Promise<AutomationDefinition[]>;
    register(definition: AutomationDefinition, options?: DurableRequestOptions): Promise<AutomationDefinition>;
    get(id: string, options?: DurableRequestOptions): Promise<AutomationDefinition>;
    enable(id: string, owner: string, options?: DurableRequestOptions): Promise<AutomationDefinition>;
    disable(id: string, owner: string, options?: DurableRequestOptions): Promise<AutomationDefinition>;
    setEnabled(id: string, owner: string, enabled: boolean, options?: DurableRequestOptions): Promise<AutomationDefinition>;
    invoke(invocation: AutomationInvocation, options?: DurableRequestOptions): Promise<AutomationInvocation>;
    events(id: string, after?: number, options?: DurableRequestOptions): Promise<AutomationEvent[]>;
    feed(id: string, options?: AutomationFeedOptions): CursorFeed<AutomationEvent>;
    invocations(id: string, options?: DurableRequestOptions): Promise<AutomationInvocation[]>;
    export(id: string, options?: DurableRequestOptions): Promise<AutomationJournalEntry[]>;
    exportAutomation(id: string, options?: DurableRequestOptions): Promise<AutomationJournalEntry[]>;
}
export declare function encodeAutomationDefinition(definition: AutomationDefinition): Record<string, unknown>;
export declare function encodeAutomationInvocation(invocation: AutomationInvocation): Record<string, unknown>;
export declare function decodeAutomationDefinition(value: unknown): AutomationDefinition;
export declare function decodeAutomationInvocation(value: unknown): AutomationInvocation;
export declare function decodeAutomationEvent(value: unknown): AutomationEvent;
export declare function decodeAutomationAuditEvent(value: unknown): AutomationAuditEvent;
export declare function decodeAutomationJournalEntry(value: unknown): AutomationJournalEntry;
//# sourceMappingURL=automations.d.ts.map