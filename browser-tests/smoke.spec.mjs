import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { MockDoMoServer } from "../dist/testing/mock-do-mo-server.js";
import { MockDoMoTcpServer } from "../dist/testing/mock-do-mo-server-node.js";

test("browser fetch and getReader SSE work with CORS", async ({ page }) => {
  const staticServer = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/dashboard.html" && !pathname.startsWith("/sdk/")) {
      response.writeHead(404);
      response.end();
      return;
    }
    const file = pathname === "/dashboard.html" ? "browser-tests/dashboard.html" : `dist/${pathname.slice("/sdk/".length)}`;
    response.writeHead(200, { "content-type": pathname.endsWith(".html") ? "text/html" : "text/javascript" });
    response.end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const address = staticServer.address();
  const staticOrigin = `http://127.0.0.1:${address.port}`;
  const mock = new MockDoMoServer({ corsOrigins: [staticOrigin] });
  const tcp = await MockDoMoTcpServer.start({ server: mock });
  try {
    await page.goto(`${staticOrigin}/dashboard.html`);
    const result = await page.evaluate(({ baseURL, token }) => window.runDoMoSmoke(baseURL, token), { baseURL: tcp.baseURL, token: mock.token });
    expect(result).toEqual({ cors: true, messageCount: 1, sawAgentEnd: true });
  } finally {
    await tcp.close();
    await new Promise((resolve, reject) => staticServer.close((error) => error ? reject(error) : resolve()));
  }
});
