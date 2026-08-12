import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transport } from "../transport.js";
export class LauncherError extends Error {
    stderr;
    constructor(message, stderr = "") { super(message); this.name = "LauncherError"; this.stderr = stderr; }
}
export function parseHandshakeLine(line, current = {}) {
    const tokenMatch = /^Authorization:\s+Bearer\s+([0-9a-f]+)\s*$/i.exec(line.trim());
    if (tokenMatch?.[1])
        return { ...current, token: tokenMatch[1] };
    const urlMatch = /domo --serve\s+.*listening on\s+(https?:\/\/[^\s(]+)/i.exec(line);
    if (urlMatch?.[1])
        return { ...current, baseURL: urlMatch[1].replace(/\/$/, "") };
    return current;
}
export class LaunchedServer {
    token;
    baseURL;
    transport;
    workspace;
    configDir;
    child;
    exited;
    cleanupIsolated;
    closed = false;
    constructor(args) {
        this.child = args.child;
        this.token = args.handshake.token;
        this.baseURL = args.handshake.baseURL;
        this.workspace = args.workspace;
        this.configDir = args.configDir;
        this.cleanupIsolated = args.cleanupIsolated;
        this.transport = new Transport({ baseURL: this.baseURL, token: this.token, ...(args.owner === undefined ? {} : { owner: args.owner }) });
        this.exited = new Promise((resolve) => this.child.once("exit", (code) => resolve(code)));
    }
    async waitForExit() { return this.exited; }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.child.exitCode === null && !this.child.killed) {
            this.child.kill("SIGTERM");
            await Promise.race([this.exited, delay(2_000)]);
            if (this.child.exitCode === null)
                this.child.kill("SIGKILL");
        }
        await this.exited;
        if (this.cleanupIsolated) {
            if (this.configDir)
                await rm(this.configDir, { recursive: true, force: true });
            if (this.workspace)
                await rm(this.workspace, { recursive: true, force: true });
        }
    }
    async [Symbol.asyncDispose]() { await this.close(); }
}
export async function launchServer(options = {}) {
    const isolated = options.isolated ?? true;
    const workspace = options.workspace ?? (isolated ? await mkdtemp(join(tmpdir(), "domocode-sdk-workspace-")) : undefined);
    const configDir = options.configDir ?? (isolated ? await mkdtemp(join(tmpdir(), "domocode-sdk-config-")) : undefined);
    const command = options.command ?? "domo";
    const args = [...(options.commandArgs ?? [])];
    if (options.appendServeArgs ?? true) {
        args.push("--serve", "--port", "0");
        if (options.trust ?? true)
            args.push("--trust");
        if (options.baseURL)
            args.push("--base-url", options.baseURL);
    }
    const environment = { ...process.env, ...options.env };
    if (configDir)
        environment.DOMOCODE_CONFIG_DIR = configDir;
    const child = spawn(command, args, { cwd: options.cwd ?? workspace, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let lineBuffer = "";
    let handshake = {};
    const stderrLines = [];
    child.stderr.on("data", (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
            stderr += `${line}\n`;
            stderrLines.push(line);
            handshake = parseHandshakeLine(line, handshake);
            if (!line.startsWith("Authorization:"))
                options.onStderr?.(line);
        }
    });
    const deadline = options.timeoutMs ?? 30_000;
    const started = Date.now();
    while (!handshake.token || !handshake.baseURL) {
        if (child.exitCode !== null)
            throw new LauncherError(`domo exited before its handshake (code ${child.exitCode})`, stderr.slice(-4096));
        if (Date.now() - started > deadline) {
            child.kill("SIGTERM");
            throw new LauncherError("Timed out waiting for the domo --serve handshake.", stderr.slice(-4096));
        }
        await delay(10);
    }
    return new LaunchedServer({ child, handshake: handshake, ...(workspace === undefined ? {} : { workspace }), ...(configDir === undefined ? {} : { configDir }), cleanupIsolated: isolated });
}
export async function connectTransport(options) {
    const token = options.token ?? (options.tokenFile ? (await readFile(options.tokenFile, "utf8")).trim() : options.env ? process.env[options.env] : undefined);
    if (!token)
        throw new LauncherError("A bearer token, tokenFile, or environment variable is required.");
    return new Transport({ baseURL: options.baseURL, token, ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.owner === undefined ? {} : { owner: options.owner }) });
}
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
//# sourceMappingURL=launcher.js.map