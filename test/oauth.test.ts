import test from "node:test";
import assert from "node:assert/strict";
import { authorizeRemoteOAuth, OAuthFlowError, refreshRemoteOAuth } from "../src/oauth.ts";
import { loopbackRedirectFactory } from "../src/node/oauth.ts";
import { DoMoCodeClient } from "../src/client.ts";
import { MockDoMoServer } from "../src/testing/mock-do-mo-server.ts";
import { MockAuthorizationServer } from "../src/testing/mock-authorization-server.ts";

async function openAuthorization(url: string): Promise<boolean> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return true;
}

test("remote OAuth follows MCP discovery, ADFS metadata, DCR, PKCE, state, and resource rules", async () => {
  const authorizationServer = await new MockAuthorizationServer({ adfsPathAppended: true }).start();
  try {
    const credential = await authorizeRemoteOAuth(
      { serverUrl: authorizationServer.serverURL },
      {
        redirect: loopbackRedirectFactory(),
        openAuthorization
      }
    );

    assert.match(credential.tokens.accessToken, /^mock-access-1$/);
    assert.equal(credential.tokens.refreshToken, "mock-refresh-1");
    assert.equal(credential.client?.clientId, "mock-client-1");
    assert.equal(authorizationServer.registrationRequests.length, 1);
    assert.equal(authorizationServer.authorizationRequests.length, 1);
    assert.equal(authorizationServer.authorizationRequests[0]?.url.searchParams.get("resource"), authorizationServer.serverURL);
    assert.equal(authorizationServer.authorizationRequests[0]?.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationServer.tokenRequests[0]?.fields.get("resource"), authorizationServer.serverURL);
    assert.equal(authorizationServer.tokenRequests[0]?.fields.get("grant_type"), "authorization_code");
  } finally {
    await authorizationServer.close();
  }
});

test("remote OAuth retains a non-rotating refresh token and sends resource on refresh", async () => {
  const authorizationServer = await new MockAuthorizationServer().start();
  try {
    const credential = await authorizeRemoteOAuth(
      { serverUrl: authorizationServer.serverURL, clientId: "configured-client" },
      { redirect: loopbackRedirectFactory(), openAuthorization }
    );
    const refreshed = await refreshRemoteOAuth(
      {
        serverUrl: authorizationServer.serverURL,
        authorizationEndpoint: authorizationServer.authorizationEndpoint,
        tokenEndpoint: authorizationServer.tokenEndpoint,
        clientId: "configured-client",
        resource: authorizationServer.serverURL
      },
      credential
    );
    assert.match(refreshed.tokens.accessToken, /^mock-access-refresh-2$/);
    assert.equal(refreshed.tokens.refreshToken, credential.tokens.refreshToken);
    const request = authorizationServer.tokenRequests.at(-1);
    assert.equal(request?.fields.get("grant_type"), "refresh_token");
    assert.equal(request?.fields.get("resource"), authorizationServer.serverURL);
  } finally {
    await authorizationServer.close();
  }
});

test("remote OAuth rejects a callback with the wrong state before spending a code", async () => {
  const authorizationServer = await new MockAuthorizationServer().start();
  try {
    await assert.rejects(
      authorizeRemoteOAuth(
        {
          serverUrl: authorizationServer.serverURL,
          authorizationEndpoint: authorizationServer.authorizationEndpoint,
          tokenEndpoint: authorizationServer.tokenEndpoint,
          clientId: "configured-client"
        },
        {
          redirect: async () => ({
            redirectUri: "http://127.0.0.1:1/oauth/callback",
            waitForCallback: async () => ({ code: "never-exchanged", state: "wrong-state" })
          })
        }
      ),
      (error: unknown) => error instanceof OAuthFlowError && error.code === "state_mismatch"
    );
    assert.equal(authorizationServer.tokenRequests.length, 0);
  } finally {
    await authorizationServer.close();
  }
});

test("remote OAuth enforces a finite timeout and closes the redirect listener", async () => {
  let closed = false;
  await assert.rejects(
    authorizeRemoteOAuth(
      {
        serverUrl: "https://mcp.example.test/mcp",
        authorizationEndpoint: "https://auth.example.test/authorize",
        tokenEndpoint: "https://auth.example.test/token",
        clientId: "configured-client"
      },
      {
        timeoutMs: 20,
        redirect: async () => ({
          redirectUri: "http://127.0.0.1:1/oauth/callback",
          waitForCallback: () => new Promise<never>(() => undefined),
          close: () => { closed = true; }
        })
      }
    ),
    (error: unknown) => error instanceof OAuthFlowError && error.code === "timeout"
  );
  assert.equal(closed, true);
});

test("authorization-code exchange is cancellation-shielded after the code is received", async () => {
  const controller = new AbortController();
  let expectedState = "";
  const fetchFunction = async (input: RequestInfo | URL): Promise<Response> => {
    if (new URL(input.toString()).pathname !== "/token") return new Response(null, { status: 404 });
    setTimeout(() => controller.abort(), 5);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return new Response(JSON.stringify({ access_token: "shielded-access-token", token_type: "Bearer" }), { status: 200 });
  };
  const credential = await authorizeRemoteOAuth(
    {
      serverUrl: "https://mcp.example.test/mcp",
      authorizationEndpoint: "https://auth.example.test/authorize",
      tokenEndpoint: "https://auth.example.test/token",
      clientId: "configured-client"
    },
    {
      fetch: fetchFunction,
      signal: controller.signal,
      redirect: async () => ({
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        setExpectedState: (state) => { expectedState = state; },
        waitForCallback: async () => ({ code: "single-use-code", state: expectedState })
      })
    }
  );
  assert.equal(credential.tokens.accessToken, "shielded-access-token");
  assert.equal(controller.signal.aborted, true);
});

test("provider error bodies cannot echo token material into SDK errors", async () => {
  const secret = "refresh-token-secret-never-log-123";
  const fetchFunction = async (): Promise<Response> => new Response(JSON.stringify({ error: "invalid_grant", error_description: secret, access_token: secret }), { status: 400 });
  await assert.rejects(
    refreshRemoteOAuth(
      {
        serverUrl: "https://mcp.example.test/mcp",
        authorizationEndpoint: "https://auth.example.test/authorize",
        tokenEndpoint: "https://auth.example.test/token",
        clientId: "configured-client"
      },
      { tokens: { accessToken: "old-access-token", refreshToken: secret } },
      { fetch: fetchFunction }
    ),
    (error: unknown) => {
      assert.doesNotMatch(String(error), new RegExp(secret));
      return error instanceof OAuthFlowError && error.code === "invalid_grant";
    }
  );
});

test("McpClient remote authorization imports the credential and reconnects the server", async () => {
  const authorizationServer = await new MockAuthorizationServer().start();
  const server = new MockDoMoServer({
    mcpOAuthConfigurations: {
      github: {
        serverUrl: authorizationServer.serverURL,
        authorizationEndpoint: authorizationServer.authorizationEndpoint,
        tokenEndpoint: authorizationServer.tokenEndpoint,
        registrationEndpoint: authorizationServer.registrationEndpoint,
        resource: authorizationServer.serverURL
      }
    }
  });
  const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, fetch: server.fetch });
  try {
    const result = await client.mcp.authorizeRemote("github", {
      redirect: loopbackRedirectFactory(),
      openAuthorization
    });
    assert.equal(result.connection.status, "connected");
    assert.equal(server.tokenImport("github")?.tokens.refreshToken, "mock-refresh-1");
  } finally {
    await client.close();
    server.close();
    await authorizationServer.close();
  }
});
