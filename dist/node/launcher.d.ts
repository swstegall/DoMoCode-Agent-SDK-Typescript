import { type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { Transport } from "../transport.ts";
export interface ServerHandshake {
    token: string;
    baseURL: string;
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
    baseURL?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onStderr?: (line: string) => void;
}
export declare class LauncherError extends Error {
    readonly stderr: string;
    constructor(message: string, stderr?: string);
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
    private closed;
    constructor(args: {
        child: ChildProcessByStdio<null, Readable, Readable>;
        handshake: ServerHandshake;
        workspace?: string;
        configDir?: string;
        cleanupIsolated: boolean;
        owner?: string;
    });
    waitForExit(): Promise<number | null>;
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
//# sourceMappingURL=launcher.d.ts.map