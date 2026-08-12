import { type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { Transport } from "../transport.ts";
import { DoMoCodeClient } from "../client.ts";
import type { SessionHandle } from "../session.ts";
export interface ServerHandshake {
    token: string;
    baseURL: string;
}
export interface TuiCommand {
    command: string;
    args: string[];
}
export interface LaunchServerOptions {
    command?: string;
    commandArgs?: string[];
    appendServeArgs?: boolean;
    cwd?: string;
    workspace?: string;
    configDir?: string;
    isolated?: boolean;
    trust?: boolean;
    port?: number;
    model?: string;
    agent?: string;
    mode?: string;
    maxTurns?: number;
    maxCostPerRun?: string | number;
    steeringMode?: "all" | "one-at-a-time";
    sandbox?: boolean;
    corsOrigins?: string[];
    signal?: AbortSignal;
    baseURL?: string;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onStderr?: (line: string) => void;
}
export declare class LauncherError extends Error {
    readonly stderr: string;
    constructor(message: string, stderr?: string);
}
export declare class ServerExitedError extends LauncherError {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    constructor(code: number | null, signal: NodeJS.Signals | null, stderr?: string);
}
export declare function parseHandshakeLine(line: string, current?: Partial<ServerHandshake>): Partial<ServerHandshake>;
export declare class LaunchedServer {
    readonly token: string;
    readonly baseURL: string;
    readonly transport: Transport;
    readonly workspace: string | undefined;
    readonly configDir: string | undefined;
    private readonly child;
    private readonly exited;
    private readonly cleanupIsolated;
    private readonly exitError;
    private readonly exitListeners;
    private readonly removeSignalListener;
    private closed;
    constructor(args: {
        child: ChildProcessByStdio<null, Readable, Readable>;
        handshake: ServerHandshake;
        workspace?: string;
        configDir?: string;
        cleanupIsolated: boolean;
        owner?: string;
        stderr?: string;
        signal?: AbortSignal;
    });
    waitForExit(): Promise<number | null>;
    /** Observe an unexpected server exit without exposing the bearer token. */
    onExit(listener: (error: ServerExitedError) => void): () => void;
    tuiCommand(command?: string, commandArgs?: string[]): TuiCommand;
    attachTui(options?: {
        command?: string;
        commandArgs?: string[];
        stdio?: "inherit" | "pipe";
    }): AttachedTui;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
export declare function launchServer(options?: LaunchServerOptions): Promise<LaunchedServer>;
export declare function connectTransport(options: {
    baseURL: string;
    token?: string;
    tokenFile?: string;
    env?: string;
    clientId?: string;
    owner?: string;
}): Promise<Transport>;
export interface ConnectOptions {
    baseURL: string;
    token?: string;
    tokenFile?: string;
    env?: string;
    clientId?: string;
    owner?: string;
    fetch?: typeof fetch;
}
/** Connect to an existing server and probe capabilities before returning. */
export declare function connect(options: ConnectOptions): Promise<DoMoCodeClient>;
export interface ReleaseAuthorityWhenIdleOptions {
    debounceMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
}
/** Release authority only after the session is settled, drained, and ask-free. */
export declare function releaseAuthorityWhenIdle(session: SessionHandle, options?: ReleaseAuthorityWhenIdleOptions): Promise<void>;
export declare class AttachedTui {
    readonly child: ChildProcess;
    private readonly exited;
    constructor(child: ChildProcess);
    waitForExit(): Promise<number | null>;
    close(): Promise<void>;
}
export type AttachedTuiHandle = AttachedTui;
//# sourceMappingURL=launcher.d.ts.map