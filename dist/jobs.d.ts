import { type CursorFeed } from "./cursorFeed.ts";
import { type Transport } from "./transport.ts";
import { type DurableRequestOptions } from "./durableSupport.ts";
import type { JobEvent, JobJournalEntry, JobRecord } from "./types/durable.ts";
export interface JobListOptions extends DurableRequestOptions {
    owner?: string;
}
export interface JobFeedOptions extends DurableRequestOptions {
    after?: number;
    pollIntervalMs?: number;
}
/** REST and cursor-feed access to DoMoCode's durable job manager. */
export declare class JobClient {
    private readonly transport;
    constructor(transport: Transport);
    list(options?: JobListOptions): Promise<JobRecord[]>;
    get(id: string, options?: DurableRequestOptions): Promise<JobRecord>;
    events(id: string, after?: number, options?: DurableRequestOptions): Promise<JobEvent[]>;
    feed(id: string, options?: JobFeedOptions): CursorFeed<JobEvent>;
    cancel(id: string, owner: string, options?: DurableRequestOptions): Promise<JobRecord>;
    recover(options?: DurableRequestOptions): Promise<JobRecord[]>;
    export(id: string, options?: DurableRequestOptions): Promise<JobJournalEntry[]>;
    exportJob(id: string, options?: DurableRequestOptions): Promise<JobJournalEntry[]>;
}
export declare function decodeJobRecord(value: unknown): JobRecord;
export declare function decodeJobEvent(value: unknown): JobEvent;
export declare function decodeJobJournalEntry(value: unknown): JobJournalEntry;
//# sourceMappingURL=jobs.d.ts.map