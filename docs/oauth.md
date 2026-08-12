# MCP OAuth

DoMoCode keeps the MCP connection and its 0600 token store in the serving process. The SDK only
receives the server's redacted OAuth configuration, completes a remote authorization-code + PKCE
flow when needed, and imports the resulting credential back through the token-import route.

In Node, use the loopback listener and provide an application-specific browser opener:

```ts
import { authorizeMcp, connect } from "domocode-agent-sdk/node";

const client = await connect({ baseURL, token });
const result = await authorizeMcp(client, "github", {
  openAuthorization: async (url) => {
    // Open the URL in the application's browser shell.
    await openInBrowser(url);
    return true;
  }
});
console.log(result.connection.status);
```

`authorizeMcp` binds an ephemeral loopback port, requires an exact OAuth `state` match, serves a
fixed success page, uses S256 PKCE, and closes the listener after the callback or timeout. The
browser URL, access token, refresh token, client secret, verifier, and authorization headers are
never written to SDK logs. A browser application can use `client.mcp.authorizeRemote()` directly
with its own redirect bridge instead of importing the Node entry point.

The remote flow follows the MCP protected-resource metadata chain, RFC 8414 and OIDC metadata
spellings (including the ADFS path-appended form), and RFC 7591 dynamic registration. `resource`
is sent on authorization-code and refresh grants. A refresh response that omits `refresh_token`
retains the existing refresh token; the Swift server remains the durable authority after import.

For a server that already has a pending same-host flow, use `client.mcp.connect(server)` and pass
the returned `authorizationUrl` to the host browser. A different client cannot replace a parked
flow's initiator.
