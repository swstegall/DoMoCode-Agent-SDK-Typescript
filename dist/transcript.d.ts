import type { Message } from "./types/messages.ts";
export type TranscriptFormat = "markdown" | "html";
export interface TranscriptOptions {
    format?: TranscriptFormat;
    title?: string;
    /** Include tool call/result payloads instead of only their visible text. */
    includeToolDetails?: boolean;
}
/** Render a lossless message projection without embedding image base64 data. */
export declare function renderTranscript(messages: Message[], options?: TranscriptOptions): string;
export declare function renderMarkdownTranscript(messages: Message[], options?: TranscriptOptions): string;
export declare function renderHTMLTranscript(messages: Message[], options?: TranscriptOptions): string;
//# sourceMappingURL=transcript.d.ts.map