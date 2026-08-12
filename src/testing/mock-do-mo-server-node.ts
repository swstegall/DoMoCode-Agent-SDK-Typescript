import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MockDoMoServer } from "./mock-do-mo-server.ts";

export interface MockDoMoTcpServerOptions {
  server?: MockDoMoServer;
  host?: string;
  port?: number;
}

/**
 * Node-only TCP adapter for the browser-safe MockDoMoServer.
 *
 * The protocol implementation remains backed by the mock's `fetch` seam; this
 * adapter only translates Node HTTP requests and streaming responses. Keeping
 * that boundary separate prevents node:http from leaking into the root SDK.
 */
export class MockDoMoTcpServer {
  readonly server: MockDoMoServer;
  readonly host: string;
  readonly port: number;
  readonly baseURL: string;
  private readonly httpServer: Server;
  private closed = false;

  private constructor(server: MockDoMoServer, httpServer: Server, host: string, port: number) {
    this.server = server;
    this.httpServer = httpServer;
    this.host = host;
    this.port = port;
    this.baseURL = `http://${host}:${port}`;
  }

  static async start(options: MockDoMoTcpServerOptions = {}): Promise<MockDoMoTcpServer> {
    const mock = options.server ?? new MockDoMoServer();
    const host = options.host ?? "127.0.0.1";
    const httpServer = createServer((request, response) => {
      void proxyRequest(mock, request, response, host, options.port ?? 0);
    });
    await listen(httpServer, host, options.port ?? 0);
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      await close(httpServer);
      throw new Error("MockDoMoServer did not expose a TCP address");
    }
    return new MockDoMoTcpServer(mock, httpServer, host, address.port);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await close(this.httpServer);
    this.server.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** Alias with the acronym capitalized for callers that prefer TCP casing. */
export const MockDoMoTCPServer = MockDoMoTcpServer;

async function proxyRequest(
  mock: MockDoMoServer,
  request: IncomingMessage,
  response: ServerResponse,
  host: string,
  port: number
): Promise<void> {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const method = request.method ?? "GET";
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8");
    const url = `http://${host}:${port}${request.url ?? "/"}`;
    const result = await mock.fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal
    });
    response.statusCode = result.status;
    for (const [name, value] of result.headers) response.setHeader(name, value);
    if (!result.body) {
      response.end();
      return;
    }
    const reader = result.body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        response.write(Buffer.from(item.value));
      }
    } finally {
      reader.releaseLock();
    }
    response.end();
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
    } else {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("MockDoMoServer request failed.");
    }
  }
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
