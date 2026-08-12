import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transport } from "../transport.js";
import { DoMoCodeClient } from "../client.js";
export class LauncherError extends Error {
    stderr;
    constructor(message, stderr = "") { super(message); this.name = "LauncherError"; this.stderr = stderr; }
}
export class ServerExitedError extends LauncherError {
    code;
    signal;
    constructor(code, signal, stderr = "") {
        super(`The DoMoCode server exited${code === null ? "" : ` with code ${code}`}${signal ? ` after ${signal}` : ""}.`, stderr);
        this.name = "ServerExitedError";
        this.code = code;
        this.signal = signal;
    }
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
    exitError;
    exitListeners = new Set();
    removeSignalListener;
    closed = false;
    constructor(args) {
        this.child = args.child;
        this.token = args.handshake.token;
        this.baseURL = args.handshake.baseURL;
        this.workspace = args.workspace;
        this.configDir = args.configDir;
        this.cleanupIsolated = args.cleanupIsolated;
        this.transport = new Transport({ baseURL: this.baseURL, token: this.token, ...(args.owner === undefined ? {} : { owner: args.owner }) });
        let resolveExit = () => undefined;
        let resolveError = () => undefined;
        this.exited = new Promise((resolve) => { resolveExit = resolve; });
        this.exitError = new Promise((resolve) => { resolveError = resolve; });
        if (args.signal) {
            const abort = () => this.child.kill("SIGTERM");
            args.signal.addEventListener("abort", abort, { once: true });
            this.removeSignalListener = () => args.signal?.removeEventListener("abort", abort);
        }
        this.child.once("exit", (code, signal) => {
            resolveExit(code);
            const error = new ServerExitedError(code, signal, args.stderr ?? "");
            resolveError(error);
            for (const listener of this.exitListeners)
                listener(error);
            this.exitListeners.clear();
        });
    }
    async waitForExit() { return this.exited; }
    /** Observe an unexpected server exit without exposing the bearer token. */
    onExit(listener) {
        if (this.child.exitCode !== null)
            void this.exitError.then(listener);
        else
            this.exitListeners.add(listener);
        return () => this.exitListeners.delete(listener);
    }
    tuiCommand(command = "domo", commandArgs = []) {
        return { command, args: [...commandArgs, "--url", this.baseURL, "--token", this.token] };
    }
    attachTui(options = {}) {
        const command = this.tuiCommand(options.command, options.commandArgs);
        const child = spawn(command.command, command.args, { stdio: options.stdio ?? "inherit" });
        return new AttachedTui(child);
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.removeSignalListener?.();
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
    const createdWorkspace = options.workspace === undefined && isolated ? await mkdtemp(join(tmpdir(), "domocode-sdk-workspace-")) : undefined;
    const createdConfigDir = options.configDir === undefined && isolated ? await mkdtemp(join(tmpdir(), "domocode-sdk-config-")) : undefined;
    const workspace = options.workspace ?? createdWorkspace;
    const configDir = options.configDir ?? createdConfigDir;
    const command = options.command ?? "domo";
    const args = [...(options.commandArgs ?? [])];
    if (options.appendServeArgs ?? true) {
        args.push("--serve", "--port", String(options.port ?? 0));
        if (options.trust ?? true)
            args.push("--trust");
        if (options.sandbox)
            args.push("--sandbox");
        appendOption(args, "--model", options.model);
        appendOption(args, "--agent", options.agent);
        appendOption(args, "--mode", options.mode);
        appendOption(args, "--max-turns", options.maxTurns);
        appendOption(args, "--max-cost-per-run", options.maxCostPerRun);
        appendOption(args, "--steering-mode", options.steeringMode);
        const baseURL = options.baseURL ?? options.baseUrl;
        if (baseURL)
            args.push("--base-url", baseURL);
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
    child.stderr.on("end", () => {
        const residual = lineBuffer.trim();
        if (residual) {
            stderr += `${residual}\n`;
            if (!residual.startsWith("Authorization:"))
                options.onStderr?.(residual);
            handshake = parseHandshakeLine(residual, handshake);
        }
    });
    const abort = () => child.kill("SIGTERM");
    if (options.signal) {
        if (options.signal.aborted)
            abort();
        else
            options.signal.addEventListener("abort", abort, { once: true });
    }
    const deadline = options.timeoutMs ?? 30_000;
    const started = Date.now();
    try {
        while (!handshake.token || !handshake.baseURL) {
            if (options.signal?.aborted)
                throw new LauncherError("Launching the DoMoCode server was aborted.", stderr.slice(-4096));
            if (child.exitCode !== null)
                throw new LauncherError(`domo exited before its handshake (code ${child.exitCode})`, stderr.slice(-4096));
            if (Date.now() - started > deadline) {
                child.kill("SIGTERM");
                throw new LauncherError("Timed out waiting for the domo --serve handshake.", stderr.slice(-4096));
            }
            await delay(10);
        }
    }
    catch (error) {
        child.kill("SIGTERM");
        await Promise.race([new Promise((resolve) => child.once("exit", () => resolve())), delay(2_000)]);
        if (createdConfigDir)
            await rm(createdConfigDir, { recursive: true, force: true });
        if (createdWorkspace)
            await rm(createdWorkspace, { recursive: true, force: true });
        throw error;
    }
    finally {
        options.signal?.removeEventListener("abort", abort);
    }
    return new LaunchedServer({ child, handshake: handshake, ...(workspace === undefined ? {} : { workspace }), ...(configDir === undefined ? {} : { configDir }), cleanupIsolated: isolated, stderr: stderr.slice(-4096), ...(options.signal === undefined ? {} : { signal: options.signal }) });
}
export async function connectTransport(options) {
    const token = await resolveToken(options);
    if (!token)
        throw new LauncherError("A bearer token, tokenFile, or environment variable is required.");
    return new Transport({ baseURL: options.baseURL, token, ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.owner === undefined ? {} : { owner: options.owner }) });
}
/** Connect to an existing server and probe capabilities before returning. */
export async function connect(options) {
    const token = await resolveToken(options);
    if (!token)
        throw new LauncherError("A bearer token, tokenFile, or environment variable is required.");
    const client = new DoMoCodeClient({ baseURL: options.baseURL, token, ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.owner === undefined ? {} : { owner: options.owner }), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
    await client.capabilities();
    return client;
}
/** Release authority only after the session is settled, drained, and ask-free. */
export async function releaseAuthorityWhenIdle(session, options = {}) {
    const debounceMs = options.debounceMs ?? 250;
    const pollMs = options.pollMs ?? 100;
    while (true) {
        if (options.signal?.aborted)
            throw options.signal.reason ?? new Error("Authority release was aborted.");
        const status = await session.status();
        const idle = !status.running && (status.queuedMessageCount ?? 0) === 0 && status.pendingPermissionIds.length === 0 && (status.pendingQuestionIds?.length ?? 0) === 0;
        if (idle) {
            await delay(debounceMs);
            const confirmed = await session.status();
            if (!confirmed.running && (confirmed.queuedMessageCount ?? 0) === 0 && confirmed.pendingPermissionIds.length === 0 && (confirmed.pendingQuestionIds?.length ?? 0) === 0) {
                await session.releaseAuthority();
                return;
            }
        }
        await delay(pollMs);
    }
}
export class AttachedTui {
    child;
    exited;
    constructor(child) {
        this.child = child;
        this.exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    }
    waitForExit() { return this.exited; }
    async close() {
        if (this.child.exitCode === null) {
            this.child.kill("SIGTERM");
            await Promise.race([this.exited, delay(2_000)]);
            if (this.child.exitCode === null)
                this.child.kill("SIGKILL");
        }
        await this.exited;
    }
}
async function resolveToken(options) {
    if (options.token)
        return options.token;
    if (options.tokenFile)
        return (await readFile(options.tokenFile, "utf8")).trim();
    if (options.env)
        return process.env[options.env];
    return undefined;
}
function appendOption(args, flag, value) {
    if (value !== undefined)
        args.push(flag, String(value));
}
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
//# sourceMappingURL=launcher.js.map