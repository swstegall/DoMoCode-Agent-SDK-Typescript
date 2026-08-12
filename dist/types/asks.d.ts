import type { JSONValue } from "./common.ts";
export interface PermissionRequest {
    id: string;
    sessionId: string;
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, JSONValue>;
    disableAlways: boolean;
}
export interface QuestionOption {
    label: string;
    description?: string;
}
export interface QuestionPrompt {
    header?: string;
    question: string;
    options: QuestionOption[];
    allowsMultiple: boolean;
}
export interface QuestionAnswer {
    selectedLabels: string[];
}
export interface PermissionInteraction extends PermissionRequest {
    kind: "permission";
}
export interface QuestionInteraction {
    kind: "question";
    id: string;
    sessionId: string;
    questions: QuestionPrompt[];
}
export interface OAuthInteraction {
    kind: "oauth";
    id: string;
    server: string;
    authorizationUrl: string;
    expiresAt: string;
    signal: AbortSignal;
    open(): Promise<boolean>;
    decline(): void;
}
export interface UnknownInteraction {
    kind: string;
    id: string;
    sessionId?: string;
    raw: unknown;
}
export type PendingInteraction = PermissionInteraction | QuestionInteraction | OAuthInteraction | UnknownInteraction;
//# sourceMappingURL=asks.d.ts.map