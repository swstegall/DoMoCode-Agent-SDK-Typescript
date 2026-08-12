import { type CursorFeed } from "./cursorFeed.ts";
import { type Transport } from "./transport.ts";
import { type DurableRequestOptions } from "./durableSupport.ts";
import type { JSONValue } from "./types/common.ts";
import type { HandoffArtifact, HandoffEvent, HandoffJournalEntry, HandoffPlan, HandoffPlanStep, HandoffRecord, HandoffRequest, HandoffTarget } from "./types/durable.ts";
export interface HandoffListOptions extends DurableRequestOptions {
    sourceSessionId?: string;
}
export interface HandoffFeedOptions extends DurableRequestOptions {
    after?: number;
    pollIntervalMs?: number;
}
/** REST and cursor-feed access to durable session handoffs. */
export declare class HandoffClient {
    private readonly transport;
    constructor(transport: Transport);
    list(options?: HandoffListOptions): Promise<HandoffRecord[]>;
    propose(request: HandoffRequest, options?: DurableRequestOptions): Promise<HandoffRecord>;
    get(id: string, options?: DurableRequestOptions): Promise<HandoffRecord>;
    events(id: string, after?: number, options?: DurableRequestOptions): Promise<HandoffEvent[]>;
    feed(id: string, options?: HandoffFeedOptions): CursorFeed<HandoffEvent>;
    accept(id: string, owner: string, options?: DurableRequestOptions): Promise<HandoffRecord>;
    complete(id: string, owner: string, target?: HandoffTarget, metadataValue?: Record<string, JSONValue>, options?: DurableRequestOptions): Promise<HandoffRecord>;
    reject(id: string, owner: string, reason?: string, options?: DurableRequestOptions): Promise<HandoffRecord>;
    cancel(id: string, owner: string, reason?: string, options?: DurableRequestOptions): Promise<HandoffRecord>;
    export(id: string, options?: DurableRequestOptions): Promise<HandoffJournalEntry[]>;
    exportHandoff(id: string, options?: DurableRequestOptions): Promise<HandoffJournalEntry[]>;
    private decision;
    private transition;
}
export declare function encodeHandoffRequest(request: HandoffRequest): Record<string, unknown>;
export declare function encodeHandoffTarget(target: HandoffTarget): Record<string, unknown>;
export declare function decodeHandoffRecord(value: unknown): HandoffRecord;
export declare function decodeHandoffRequest(value: unknown): HandoffRequest;
export declare function decodeHandoffTarget(value: unknown): HandoffTarget;
export declare function decodeHandoffArtifact(value: unknown): HandoffArtifact;
export declare function decodeHandoffPlan(value: unknown): HandoffPlan;
export declare function decodeHandoffPlanStep(value: unknown): HandoffPlanStep;
export declare function decodeHandoffEvent(value: unknown): HandoffEvent;
export declare function decodeHandoffJournalEntry(value: unknown): HandoffJournalEntry;
//# sourceMappingURL=handoffs.d.ts.map