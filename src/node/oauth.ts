import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { DoMoCodeClient } from "../client.ts";
import { type OAuthCallback, type OAuthRedirectFactory, type OAuthRedirectSession, type RemoteOAuthOptions } from "../oauth.ts";

export interface LoopbackRedirectOptions {
  host?: string;
  port?: number;
  path?: string;
}

/**
 * Bind a fresh local callback listener. The listener rejects mismatched state
 * before resolving the flow and always serves a fixed success page; it never
 * reflects provider-controlled HTML or token material.
 */
export function loopbackRedirectFactory(options: LoopbackRedirectOptions = {}): OAuthRedirectFactory {
  return async ({ signal }) => {
    const host = options.host ?? "127.0.0.1";
    const path = options.path ?? "/oauth/callback";
    const requestedPort = options.port ?? 0;
    const server = createServer();
    let expectedState: string | undefined;
    let resolveCallback: (callback: OAuthCallback) => void = () => undefined;
    const callback = new Promise<OAuthCallback>((resolve) => { resolveCallback = resolve; });
    server.on("request", (request, response) => {
      void handleCallback(request, response, path, () => expectedState, resolveCallback);
    });
    await listen(server, host, requestedPort);
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : requestedPort;
    const hostForURL = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    const redirectUri = `http://${hostForURL}:${actualPort}${path}`;
    const closeOnAbort = () => { void closeServer(server); };
    if (signal.aborted) closeOnAbort();
    else signal.addEventListener("abort", closeOnAbort, { once: true });

    const session: OAuthRedirectSession = {
      redirectUri,
      setExpectedState: (state) => { expectedState = state; },
      waitForCallback: async (input) => {
        await input.openAuthorization?.(input.authorizationUrl);
        return await callback;
      },
      close: async () => {
        signal.removeEventListener("abort", closeOnAbort);
        await closeServer(server);
      }
    };
    return session;
  };
}

/** Open the system browser without putting the authorization URL in a log. */
export function openSystemBrowser(url: string): Promise<boolean> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export interface AuthorizeMcpOptions extends Omit<RemoteOAuthOptions, "redirect"> {
  redirect?: OAuthRedirectFactory;
  loopback?: LoopbackRedirectOptions;
}

/** Node convenience wrapper: loopback listener plus the host's system browser. */
export async function authorizeMcp(
  client: DoMoCodeClient,
  server: string,
  options: AuthorizeMcpOptions = {}
) {
  const { redirect, loopback, openAuthorization, ...flowOptions } = options;
  return client.mcp.authorizeRemote(server, {
    ...flowOptions,
    redirect: redirect ?? loopbackRedirectFactory(loopback),
    openAuthorization: openAuthorization ?? openSystemBrowser
  });
}

async function handleCallback(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  expectedPath: string,
  expectedState: () => string | undefined,
  resolveCallback: (callback: OAuthCallback) => void
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET" || url.pathname !== expectedPath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
    return;
  }
  const state = url.searchParams.get("state") ?? undefined;
  if (!state || state !== expectedState()) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("OAuth state mismatch.");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end("<!doctype html><title>Authentication complete</title><p>Authentication complete. You may close this window.</p>");
  const callback: OAuthCallback = { state };
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (code !== null) callback.code = code;
  if (error !== null) callback.error = error;
  if (errorDescription !== null) callback.errorDescription = errorDescription;
  resolveCallback(callback);
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
