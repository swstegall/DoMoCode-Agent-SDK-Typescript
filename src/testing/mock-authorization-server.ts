import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

export interface MockAuthorizationServerOptions {
  host?: string;
  port?: number;
  adfsPathAppended?: boolean;
  dynamicRegistration?: boolean;
  requireResource?: boolean;
  requirePKCE?: boolean;
  accessTokenPrefix?: string;
  refreshTokenPrefix?: string;
}

export interface MockAuthorizationRequest {
  url: URL;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  clientId: string;
  resource: string | undefined;
}

export interface MockTokenRequest {
  fields: URLSearchParams;
}

/**
 * A deterministic authorization server for SDK conformance tests. It serves
 * the MCP 401 → protected-resource → ADFS/OIDC metadata chain, RFC 7591,
 * authorization-code + PKCE, and refresh responses that omit refresh_token to
 * exercise non-rotating refresh retention.
 */
export class MockAuthorizationServer {
  readonly host: string;
  readonly requestedPort: number;
  readonly authorizationRequests: MockAuthorizationRequest[] = [];
  readonly registrationRequests: Record<string, unknown>[] = [];
  readonly tokenRequests: MockTokenRequest[] = [];
  private readonly adfsPathAppended: boolean;
  private readonly dynamicRegistration: boolean;
  private readonly requireResource: boolean;
  private readonly requirePKCE: boolean;
  private readonly accessTokenPrefix: string;
  private readonly refreshTokenPrefix: string;
  private readonly issuedCodes = new Map<string, MockAuthorizationRequest>();
  private readonly issuedRefreshTokens = new Set<string>();
  private server: Server | undefined;
  private actualPort: number | undefined;
  private tokenCounter = 0;

  constructor(options: MockAuthorizationServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.adfsPathAppended = options.adfsPathAppended ?? false;
    this.dynamicRegistration = options.dynamicRegistration ?? true;
    this.requireResource = options.requireResource ?? true;
    this.requirePKCE = options.requirePKCE ?? true;
    this.accessTokenPrefix = options.accessTokenPrefix ?? "mock-access";
    this.refreshTokenPrefix = options.refreshTokenPrefix ?? "mock-refresh";
  }

  get port(): number { return this.actualPort ?? this.requestedPort; }
  get baseURL(): string { return `http://${this.host}:${this.port}`; }
  get serverURL(): string { return `${this.baseURL}/mcp`; }
  get issuerURL(): string { return `${this.baseURL}/adfs`; }
  get protectedResourceMetadataURL(): string { return `${this.baseURL}/.well-known/oauth-protected-resource/mcp`; }
  get authorizationEndpoint(): string { return `${this.baseURL}/authorize`; }
  get tokenEndpoint(): string { return `${this.baseURL}/token`; }
  get registrationEndpoint(): string { return `${this.baseURL}/register`; }

  async start(): Promise<this> {
    if (this.server) return this;
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.listen(this.requestedPort, this.host);
    await once(this.server, "listening");
    const address = this.server.address();
    if (address && typeof address === "object") this.actualPort = address.port;
    return this;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const closed = once(this.server, "close").catch(() => undefined);
    this.server.close();
    await closed;
    this.server = undefined;
    this.actualPort = undefined;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.baseURL);
    try {
      if (request.method === "GET" && url.pathname === "/mcp") {
        response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${this.protectedResourceMetadataURL}", scope="mcp.read"` });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        this.json(response, {
          resource: this.serverURL,
          authorization_servers: [this.issuerURL],
          scopes_supported: ["mcp.read"]
        });
        return;
      }
      if (request.method === "GET" && this.isAuthorizationMetadataPath(url.pathname)) {
        this.json(response, {
          issuer: this.issuerURL,
          authorization_endpoint: this.authorizationEndpoint,
          token_endpoint: this.tokenEndpoint,
          ...(this.dynamicRegistration ? { registration_endpoint: this.registrationEndpoint } : {}),
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp.read"]
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/register") {
        const value = await readJSONBody(request);
        this.registrationRequests.push(value);
        this.json(response, { client_id: `mock-client-${this.registrationRequests.length}`, token_endpoint_auth_method: "none" }, 201);
        return;
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        const codeChallenge = url.searchParams.get("code_challenge");
        const state = url.searchParams.get("state");
        const redirectUri = url.searchParams.get("redirect_uri");
        const clientId = url.searchParams.get("client_id");
        if (!codeChallenge || !state || !redirectUri || !clientId || (this.requirePKCE && url.searchParams.get("code_challenge_method") !== "S256")) {
          response.writeHead(400).end("invalid authorization request");
          return;
        }
        const requestInfo: MockAuthorizationRequest = {
          url,
          codeChallenge,
          state,
          redirectUri,
          clientId,
          resource: url.searchParams.get("resource") ?? undefined
        };
        this.authorizationRequests.push(requestInfo);
        const code = `mock-code-${this.authorizationRequests.length}`;
        this.issuedCodes.set(code, requestInfo);
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", state);
        response.writeHead(302, { location: callback.toString() });
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/token") {
        await this.handleToken(request, response);
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(500).end();
    }
  }

  private async handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fields = new URLSearchParams(await readBody(request));
    this.tokenRequests.push({ fields });
    const grantType = fields.get("grant_type");
    const resource = fields.get("resource");
    if (this.requireResource && resource !== this.serverURL) {
      this.json(response, { error: "invalid_target", error_description: "resource is required" }, 400);
      return;
    }
    if (grantType === "authorization_code") {
      const code = fields.get("code");
      const verifier = fields.get("code_verifier");
      const pending = code ? this.issuedCodes.get(code) : undefined;
      if (!pending || !verifier || (this.requirePKCE && base64URL(new Uint8Array(createHash("sha256").update(verifier).digest())) !== pending.codeChallenge)) {
        this.json(response, { error: "invalid_grant" }, 400);
        return;
      }
      this.issuedCodes.delete(code!);
      const accessToken = `${this.accessTokenPrefix}-${++this.tokenCounter}`;
      const refreshToken = `${this.refreshTokenPrefix}-${this.tokenCounter}`;
      this.issuedRefreshTokens.add(refreshToken);
      this.json(response, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        refresh_token_expires_in: 86_400,
        scope: "mcp.read"
      });
      return;
    }
    if (grantType === "refresh_token") {
      const refreshToken = fields.get("refresh_token");
      if (!refreshToken || !this.issuedRefreshTokens.has(refreshToken)) {
        this.json(response, { error: "invalid_grant" }, 400);
        return;
      }
      this.json(response, { access_token: `${this.accessTokenPrefix}-refresh-${++this.tokenCounter}`, token_type: "Bearer", expires_in: 3600, scope: "mcp.read" });
      return;
    }
    this.json(response, { error: "unsupported_grant_type" }, 400);
  }

  private isAuthorizationMetadataPath(path: string): boolean {
    if (this.adfsPathAppended) return path === "/adfs/.well-known/openid-configuration";
    return path === "/.well-known/oauth-authorization-server/adfs" || path === "/.well-known/oauth-authorization-server";
  }

  private json(response: ServerResponse, value: unknown, status = 200): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  let value = "";
  request.setEncoding("utf8");
  for await (const chunk of request) value += chunk;
  return value;
}

async function readJSONBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request);
  const value: unknown = JSON.parse(body);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function base64URL(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
