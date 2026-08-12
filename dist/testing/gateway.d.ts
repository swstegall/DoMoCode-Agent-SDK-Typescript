export interface MockToolCall {
    id?: string;
    name: string;
    arguments?: unknown;
}
export interface MockCompletion {
    text?: string;
    toolCalls?: MockToolCall[];
    finishReason?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export interface MockGatewayOptions {
    port?: number;
    host?: string;
    model?: string;
    responses?: MockCompletion[];
}
export declare class ScriptedMockGateway {
    readonly host: string;
    readonly requestedPort: number;
    readonly model: string;
    private readonly responses;
    private readonly requests;
    private server;
    private actualPort;
    constructor(options?: MockGatewayOptions);
    get port(): number;
    get baseURL(): string;
    get requestLog(): readonly unknown[];
    enqueue(response: MockCompletion): void;
    reset(): void;
    start(): Promise<this>;
    close(): Promise<void>;
    private handle;
}
//# sourceMappingURL=gateway.d.ts.map