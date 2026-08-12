import { DoMoError } from "./types/errors.ts";
import { isRecord, requiredString } from "./types/common.ts";
import type { FetchFunction } from "./transport.ts";
import type { McpOAuthClientRegistration, McpOAuthConfiguration, McpOAuthCredential, McpOAuthTokens } from "./types/mcp.ts";

export interface OAuthCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface OAuthRedirectSession {
  readonly redirectUri: string;
  setExpectedState?(state: string): void;
  waitForCallback(input: {
    authorizationUrl: string;
    signal: AbortSignal;
    openAuthorization?: (authorizationUrl: string) => Promise<boolean> | boolean;
  }): Promise<OAuthCallback | string>;
  close?(): Promise<void> | void;
}

export type OAuthRedirectFactory = (input: { signal: AbortSignal }) => Promise<OAuthRedirectSession>;

export interface RemoteOAuthOptions {
  fetch?: FetchFunction;
  signal?: AbortSignal;
  timeoutMs?: number;
  openAuthorization?: (authorizationUrl: string) => Promise<boolean> | boolean;
  redirect?: OAuthRedirectFactory;
  redirectUri?: string;
  waitForRedirect?: (input: {
    authorizationUrl: string;
    redirectUri: string;
    signal: AbortSignal;
  }) => Promise<OAuthCallback | string>;
  clientName?: string;
}

export interface OAuthDiscoveryResult {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  issuer?: string;
  codeChallengeMethodsSupported?: string[];
  scopesSupported?: string[];
  scopeHint?: string;
  resource?: string;
}

export class OAuthFlowError extends DoMoError {
  readonly code: string | undefined;

  constructor(message: string, code?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OAuthFlowError";
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Run the remote authorization-code + PKCE flow without depending on a
 * browser or Node runtime. Hosts provide either a redirect session (Node's
 * loopback helper does this) or a browser/web callback bridge.
 */
export async function authorizeRemoteOAuth(
  configuration: McpOAuthConfiguration,
  options: RemoteOAuthOptions = {}
): Promise<McpOAuthCredential> {
  const fetchFunction = options.fetch ?? defaultFetch;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new OAuthFlowError("OAuth authorization timed out.", "timeout")), timeoutMs) : undefined;
  const parentAbort = () => controller.abort(options.signal?.reason ?? new OAuthFlowError("OAuth authorization was cancelled.", "cancelled"));
  if (options.signal) {
    if (options.signal.aborted) parentAbort();
    else options.signal.addEventListener("abort", parentAbort, { once: true });
  }

  let redirectSession: OAuthRedirectSession | undefined;
  try {
    throwIfAborted(controller.signal);
    const resolved = await resolveOAuthConfiguration(configuration, { fetch: fetchFunction, signal: controller.signal });

    if (options.redirect) redirectSession = await options.redirect({ signal: controller.signal });
    const redirectUri = redirectSession?.redirectUri ?? options.redirectUri ?? resolved.redirectUri;
    if (!redirectUri) {
      throw new OAuthFlowError(
        "Remote OAuth requires a loopback redirect session or an explicit redirectUri.",
        "redirect_required"
      );
    }

    const client = resolved.clientId
      ? { clientId: resolved.clientId }
      : await registerClient(resolved, redirectUri, fetchFunction, controller.signal, options.clientName);
    const pkce = await createPKCE();
    const state = randomBase64URL(16);
    redirectSession?.setExpectedState?.(state);

    const authorizationUrl = buildAuthorizationURL(resolved, client.clientId, redirectUri, pkce.challenge, state);
    const callbackPromise = redirectSession
      ? redirectSession.waitForCallback({
          authorizationUrl,
          signal: controller.signal,
          ...(options.openAuthorization === undefined ? {} : { openAuthorization: options.openAuthorization })
        })
      : options.waitForRedirect
        ? (options.openAuthorization === undefined
          ? options.waitForRedirect({ authorizationUrl, redirectUri, signal: controller.signal })
          : (async () => {
              await options.openAuthorization?.(authorizationUrl);
              return options.waitForRedirect?.({ authorizationUrl, redirectUri, signal: controller.signal }) ?? "";
            })())
        : Promise.reject(new OAuthFlowError("Remote OAuth requires a redirect callback handler.", "redirect_required"));
    const callback = normalizeCallback(await raceWithAbort(callbackPromise, controller.signal));
    if (callback.state !== state) throw new OAuthFlowError("OAuth callback state did not match.", "state_mismatch");
    if (callback.error) {
      throw new OAuthFlowError("The authorization server denied access.", safeProviderErrorCode(callback.error));
    }
    if (!callback.code) throw new OAuthFlowError("OAuth callback did not contain an authorization code.", "missing_code");

    // Do not spend a one-shot authorization code after the caller has already
    // cancelled. Once this check passes, the exchange intentionally omits the
    // caller's signal so a cancelled task cannot burn the code without handing
    // the resulting credential back to the server.
    throwIfAborted(controller.signal);
    const response = await exchangeAuthorizationCode(
      resolved,
      client,
      callback.code,
      redirectUri,
      pkce.verifier,
      fetchFunction
    );
    return { tokens: response, client };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", parentAbort);
    await redirectSession?.close?.();
  }
}

/** Resolve missing endpoints using MCP protected-resource and RFC 8414/OIDC discovery. */
export async function resolveOAuthConfiguration(
  configuration: McpOAuthConfiguration,
  options: { fetch?: FetchFunction; signal?: AbortSignal; wwwAuthenticate?: string } = {}
): Promise<McpOAuthConfiguration> {
  if (!configuration.serverUrl) throw new OAuthFlowError("OAuth serverUrl is required.", "configuration");
  if ((configuration.authorizationEndpoint && !configuration.tokenEndpoint) || (!configuration.authorizationEndpoint && configuration.tokenEndpoint)) {
    throw new OAuthFlowError("OAuth authorizationEndpoint and tokenEndpoint must be configured together.", "configuration");
  }
  if (configuration.authorizationEndpoint && configuration.tokenEndpoint) return configuration;
  const discovered = await discoverOAuth(configuration.serverUrl, options);
  return {
    ...configuration,
    authorizationEndpoint: configuration.authorizationEndpoint ?? discovered.authorizationEndpoint,
    tokenEndpoint: configuration.tokenEndpoint ?? discovered.tokenEndpoint,
    ...(configuration.registrationEndpoint === undefined && discovered.registrationEndpoint === undefined ? {} : { registrationEndpoint: configuration.registrationEndpoint ?? discovered.registrationEndpoint }),
    ...(configuration.issuer === undefined && discovered.issuer === undefined ? {} : { issuer: configuration.issuer ?? discovered.issuer }),
    ...(configuration.codeChallengeMethodsSupported === undefined && discovered.codeChallengeMethodsSupported === undefined ? {} : { codeChallengeMethodsSupported: configuration.codeChallengeMethodsSupported ?? discovered.codeChallengeMethodsSupported }),
    ...(configuration.scopesSupported === undefined && discovered.scopesSupported === undefined ? {} : { scopesSupported: configuration.scopesSupported ?? discovered.scopesSupported }),
    ...(configuration.scope === undefined && discovered.scopeHint === undefined ? {} : { scope: configuration.scope ?? discovered.scopeHint }),
    ...(configuration.resource === undefined && discovered.resource === undefined ? {} : { resource: configuration.resource ?? discovered.resource })
  };
}

/** The discovery chain is exported so browser hosts can run it before choosing a redirect UX. */
export async function discoverOAuth(
  serverURL: string,
  options: { fetch?: FetchFunction; signal?: AbortSignal; wwwAuthenticate?: string } = {}
): Promise<OAuthDiscoveryResult> {
  const fetchFunction = options.fetch ?? defaultFetch;
  const server = httpURL(serverURL, "OAuth serverUrl");
  let challenge = options.wwwAuthenticate;
  if (challenge === undefined) {
    const response = await fetchOptional(fetchFunction, server, options.signal);
    challenge = response?.headers.get("www-authenticate") ?? undefined;
  }

  let scopeHint = challenge === undefined ? undefined : authParameter("scope", challenge);
  const resourceURLs: URL[] = [];
  const fromChallenge = challenge === undefined ? undefined : authParameter("resource_metadata", challenge);
  if (fromChallenge) addUniqueURL(resourceURLs, fromChallenge);
  const defaultResourceURL = wellKnown(server, "oauth-protected-resource", true);
  if (defaultResourceURL) addUniqueURL(resourceURLs, defaultResourceURL.toString());

  let resource: string | undefined;
  let issuers: string[] = [];
  for (const resourceURL of resourceURLs) {
    const metadata = await getJSON(fetchFunction, resourceURL, options.signal);
    if (!metadata) continue;
    if (typeof metadata.resource === "string") resource = metadata.resource;
    if (scopeHint === undefined) {
      const scopes = stringArray(metadata.scopes_supported);
      if (scopes?.length) scopeHint = scopes.join(" ");
    }
    const candidates = stringArray(metadata.authorization_servers);
    if (candidates?.length) {
      issuers = candidates;
      break;
    }
  }
  if (issuers.length === 0) issuers = [server.origin];

  for (const issuer of issuers) {
    let issuerURL: URL;
    try { issuerURL = new URL(issuer); } catch { continue; }
    for (const candidate of metadataCandidates(issuerURL)) {
      const metadata = await getJSON(fetchFunction, candidate, options.signal);
      if (!metadata || typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") continue;
      const codeChallengeMethodsSupported = stringArray(metadata.code_challenge_methods_supported);
      const scopesSupported = stringArray(metadata.scopes_supported);
      return {
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        ...(typeof metadata.registration_endpoint === "string" ? { registrationEndpoint: metadata.registration_endpoint } : {}),
        ...(typeof metadata.issuer === "string" ? { issuer: metadata.issuer } : {}),
        ...(codeChallengeMethodsSupported === undefined ? {} : { codeChallengeMethodsSupported }),
        ...(scopesSupported === undefined ? {} : { scopesSupported }),
        ...(scopeHint === undefined ? {} : { scopeHint }),
        ...(resource === undefined ? {} : { resource })
      };
    }
  }
  throw new OAuthFlowError("No authorization-server metadata was found for the MCP server.", "discovery_failed");
}

/** Refresh an imported credential, retaining a non-rotating refresh token when omitted. */
export async function refreshRemoteOAuth(
  configuration: McpOAuthConfiguration,
  credential: McpOAuthCredential,
  options: Pick<RemoteOAuthOptions, "fetch" | "signal"> = {}
): Promise<McpOAuthCredential> {
  if (!credential.tokens.refreshToken) throw new OAuthFlowError("The OAuth credential has no refresh token.", "refresh_required");
  const resolved = await resolveOAuthConfiguration(configuration, options);
  const client = credential.client ?? (resolved.clientId ? { clientId: resolved.clientId } : undefined);
  if (!client) throw new OAuthFlowError("Refreshing OAuth requires a client registration.", "client_required");
  throwIfAborted(options.signal);
  const fields: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: credential.tokens.refreshToken,
    client_id: client.clientId
  };
  if (client.clientSecret) fields.client_secret = client.clientSecret;
  if (resolved.resource ?? canonicalResource(resolved.serverUrl)) fields.resource = resolved.resource ?? canonicalResource(resolved.serverUrl);
  if (resolved.scope) fields.scope = resolved.scope;
  const response = await postTokenForm(resolved.tokenEndpoint, fields, options.fetch ?? defaultFetch);
  const now = Date.now() / 1000;
  const refreshToken = response.refreshToken ?? credential.tokens.refreshToken;
  const sameRefreshToken = response.refreshToken === undefined || response.refreshToken === credential.tokens.refreshToken;
  return {
    client,
    tokens: {
      accessToken: response.accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(response.expiresIn === undefined ? {} : { expiresAt: now + response.expiresIn }),
      ...(response.refreshTokenExpiresIn === undefined && !sameRefreshToken ? {} : response.refreshTokenExpiresIn === undefined ? (credential.tokens.refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt: credential.tokens.refreshTokenExpiresAt }) : { refreshTokenExpiresAt: now + response.refreshTokenExpiresIn }),
      ...(response.scope ?? credential.tokens.scope ?? resolved.scope ? { scope: response.scope ?? credential.tokens.scope ?? resolved.scope } : {})
    }
  };
}

async function registerClient(
  configuration: McpOAuthConfiguration,
  redirectUri: string,
  fetchFunction: FetchFunction,
  signal: AbortSignal,
  clientName = "DoMoCode"
): Promise<McpOAuthClientRegistration> {
  if (!configuration.registrationEndpoint) {
    throw new OAuthFlowError("The authorization server does not offer dynamic client registration; configure clientId.", "client_registration_required");
  }
  const registrationURL = httpURL(configuration.registrationEndpoint, "OAuth registration endpoint");
  const body = {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: clientName,
    ...(configuration.scope === undefined ? {} : { scope: configuration.scope })
  };
  const response = await fetchFunction(registrationURL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const value = await readJSON(response);
  if (response.status < 200 || response.status >= 300) throw oauthHTTPError("Dynamic client registration failed", response.status, value);
  if (!isRecord(value) || typeof value.client_id !== "string") throw new OAuthFlowError("The dynamic registration response was invalid.", "client_registration_invalid");
  return {
    clientId: value.client_id,
    ...(typeof value.client_secret === "string" ? { clientSecret: value.client_secret } : {}),
    ...(typeof value.client_secret_expires_at === "number" && value.client_secret_expires_at !== 0 ? { clientSecretExpiresAt: value.client_secret_expires_at } : {})
  };
}

function buildAuthorizationURL(
  configuration: McpOAuthConfiguration,
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string
): string {
  if (!configuration.authorizationEndpoint || !configuration.tokenEndpoint) throw new OAuthFlowError("OAuth endpoints are incomplete.", "configuration");
  if (configuration.codeChallengeMethodsSupported && !configuration.codeChallengeMethodsSupported.some((method) => method.toUpperCase() === "S256")) {
    throw new OAuthFlowError("The authorization server does not advertise S256 PKCE support.", "pkce_required");
  }
  const url = httpURL(configuration.authorizationEndpoint, "OAuth authorization endpoint");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (configuration.scope) url.searchParams.set("scope", configuration.scope);
  url.searchParams.set("resource", configuration.resource ?? canonicalResource(configuration.serverUrl));
  return url.toString();
}

async function exchangeAuthorizationCode(
  configuration: McpOAuthConfiguration,
  client: McpOAuthClientRegistration,
  code: string,
  redirectUri: string,
  verifier: string,
  fetchFunction: FetchFunction
): Promise<McpOAuthTokens> {
  if (!configuration.tokenEndpoint) throw new OAuthFlowError("OAuth token endpoint is missing.", "configuration");
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    code_verifier: verifier,
    resource: configuration.resource ?? canonicalResource(configuration.serverUrl)
  };
  if (client.clientSecret) fields.client_secret = client.clientSecret;
  const response = await postTokenForm(configuration.tokenEndpoint, fields, fetchFunction);
  return {
    accessToken: response.accessToken,
    ...(response.refreshToken === undefined ? {} : { refreshToken: response.refreshToken }),
    ...(response.expiresIn === undefined ? {} : { expiresAt: Date.now() / 1000 + response.expiresIn }),
    ...(response.refreshTokenExpiresIn === undefined ? {} : { refreshTokenExpiresAt: Date.now() / 1000 + response.refreshTokenExpiresIn }),
    ...(response.scope === undefined ? {} : { scope: response.scope })
  };
}

interface ParsedTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
}

async function postTokenForm(endpoint: string | undefined, fields: Record<string, string>, fetchFunction: FetchFunction): Promise<ParsedTokenResponse> {
  if (!endpoint) throw new OAuthFlowError("OAuth token endpoint is missing.", "configuration");
  const response = await fetchFunction(httpURL(endpoint, "OAuth token endpoint"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  const value = await readJSON(response);
  if (response.status < 200 || response.status >= 300) throw oauthHTTPError("OAuth token exchange failed", response.status, value);
  if (!isRecord(value) || typeof value.access_token !== "string" || value.access_token.length === 0) throw new OAuthFlowError("The OAuth token response was invalid.", "token_invalid");
  if (value.token_type !== undefined && (typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer")) throw new OAuthFlowError("The authorization server issued a non-Bearer token.", "token_type");
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.expires_in === "number" ? { expiresIn: value.expires_in } : {}),
    ...(typeof value.refresh_token_expires_in === "number" ? { refreshTokenExpiresIn: value.refresh_token_expires_in } : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope } : {})
  };
}

async function readJSON(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

function oauthHTTPError(prefix: string, status: number, value: unknown): OAuthFlowError {
  const code = isRecord(value) && typeof value.error === "string" ? sanitizeOAuthText(value.error) : undefined;
  // Provider error descriptions are untrusted text and can echo a code,
  // verifier, or token. Keep the error actionable by status while excluding
  // the provider's body from both the message and the exposed error code.
  return new OAuthFlowError(`${prefix} (HTTP ${status}).`, code === undefined ? undefined : safeProviderErrorCode(code));
}

async function fetchOptional(fetchFunction: FetchFunction, url: URL, signal?: AbortSignal): Promise<Response | undefined> {
  try {
    return await fetchFunction(url, { method: "GET", headers: { accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

async function getJSON(fetchFunction: FetchFunction, url: URL, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const response = await fetchOptional(fetchFunction, url, signal);
  if (!response || response.status < 200 || response.status >= 300) return undefined;
  const value = await readJSON(response);
  return isRecord(value) ? value : undefined;
}

function metadataCandidates(issuer: URL): URL[] {
  const result: URL[] = [];
  const add = (value: URL | undefined) => { if (value && !result.some((candidate) => candidate.toString() === value.toString())) result.push(value); };
  add(wellKnown(issuer, "oauth-authorization-server", true));
  add(wellKnown(issuer, "oauth-authorization-server", false));
  add(wellKnown(issuer, "openid-configuration", true));
  const appended = new URL(issuer.toString());
  appended.pathname = `${appended.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  appended.search = "";
  appended.hash = "";
  add(appended);
  return result;
}

function wellKnown(url: URL, suffix: string, pathInserted: boolean): URL | undefined {
  const result = new URL(url.toString());
  const path = result.pathname === "/" ? "" : result.pathname;
  result.pathname = `/.well-known/${suffix}${pathInserted ? path : ""}`;
  result.search = "";
  result.hash = "";
  return result;
}

function addUniqueURL(values: URL[], value: string): void {
  try {
    const url = new URL(value);
    if (!values.some((item) => item.toString() === url.toString())) values.push(url);
  } catch {
    // A malformed provider hint is not a reason to skip the RFC default.
  }
}

function authParameter(name: string, header: string): string | undefined {
  const target = name.toLowerCase();
  let index = 0;
  while (index < header.length) {
    if (header[index] === '"') {
      index += 1;
      while (index < header.length) {
        if (header[index] === "\\") index += 2;
        else if (header[index++] === '"') break;
      }
      continue;
    }
    const boundary = index === 0 || header[index - 1] === "," || header[index - 1] === " " || header[index - 1] === "\t";
    if (boundary && header.slice(index, index + target.length).toLowerCase() === target) {
      let cursor = index + target.length;
      while (header[cursor] === " " || header[cursor] === "\t") cursor += 1;
      if (header[cursor] !== "=") { index += 1; continue; }
      cursor += 1;
      while (header[cursor] === " " || header[cursor] === "\t") cursor += 1;
      if (header[cursor] === '"') {
        cursor += 1;
        let value = "";
        while (cursor < header.length && header[cursor] !== '"') {
          if (header[cursor] === "\\" && cursor + 1 < header.length) cursor += 1;
          value += header[cursor++];
        }
        return value || undefined;
      }
      const end = header.slice(cursor).search(/[ \t,]/);
      const value = end < 0 ? header.slice(cursor) : header.slice(cursor, cursor + end);
      return value || undefined;
    }
    index += 1;
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string");
  return result.length === value.length ? result : undefined;
}

function canonicalResource(serverURL: string): string {
  const url = httpURL(serverURL, "OAuth serverUrl");
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (url.pathname === "/") url.pathname = "";
  else url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

async function createPKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBase64URL(64);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64URL(new Uint8Array(digest)) };
}

function randomBase64URL(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return base64URL(bytes);
}

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeCallback(value: OAuthCallback | string): OAuthCallback {
  if (typeof value !== "string") return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthFlowError("OAuth redirect was not a valid URL.", "callback_invalid"); }
  const callback: OAuthCallback = {};
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (code !== null) callback.code = code;
  if (state !== null) callback.state = state;
  if (error !== null) callback.error = error;
  if (errorDescription !== null) callback.errorDescription = errorDescription;
  return callback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new OAuthFlowError("OAuth authorization was cancelled.", "cancelled");
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new OAuthFlowError("OAuth authorization was cancelled.", "cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); }
    );
  });
}

function sanitizeOAuthText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 300);
}

function httpURL(value: string, field: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthFlowError(`${field} is not a valid URL.`, "configuration"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OAuthFlowError(`${field} must use HTTP or HTTPS.`, "configuration");
  return url;
}

function safeProviderErrorCode(value: string): string {
  const normalized = sanitizeOAuthText(value).toLowerCase();
  return /^(access_denied|invalid_grant|invalid_request|invalid_client|invalid_scope|unauthorized_client|unsupported_grant_type|server_error|temporarily_unavailable)$/.test(normalized)
    ? normalized
    : "provider_error";
}

const defaultFetch: FetchFunction = (input, init) => fetch(input, init);
