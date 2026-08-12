import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

export interface MockToolCall { id?: string; name: string; arguments?: unknown }
export interface MockCompletion { text?: string; toolCalls?: MockToolCall[]; finishReason?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
export interface MockGatewayOptions { port?: number; host?: string; model?: string; responses?: MockCompletion[] }

export class ScriptedMockGateway {
  readonly host: string;
  readonly requestedPort: number;
  readonly model: string;
  private readonly responses: MockCompletion[];
  private readonly requests: unknown[] = [];
  private server: Server | undefined;
  private actualPort: number | undefined;

  constructor(options: MockGatewayOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.model = options.model ?? "mock-model";
    this.responses = [...(options.responses ?? [])];
  }

  get port(): number { return this.actualPort ?? this.requestedPort; }
  get baseURL(): string { return `http://${this.host}:${this.port}/v1`; }
  get requestLog(): readonly unknown[] { return this.requests; }

  enqueue(response: MockCompletion): void { this.responses.push(response); }
  reset(): void { this.responses.length = 0; this.requests.length = 0; }

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
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) { response.writeHead(404).end(); return; }
    const raw = await readBody(request);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { response.writeHead(400).end("invalid json"); return; }
    this.requests.push(body);
    const scripted = this.responses.shift() ?? { text: "mock response" };
    const stream = body.stream === true;
    if (!stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: "chat.completion", model: this.model, choices: [{ index: 0, message: { role: "assistant", content: scripted.text ?? null, ...(scripted.toolCalls ? { tool_calls: scripted.toolCalls.map((call, index) => ({ id: call.id ?? `call_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } })) } : {}) }, finish_reason: scripted.finishReason ?? (scripted.toolCalls ? "tool_calls" : "stop") }], usage: scripted.usage ?? { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive", "cache-control": "no-cache" });
    const id = `chatcmpl-${Date.now()}`;
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: this.model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
    if (scripted.text) {
      for (const chunk of splitText(scripted.text)) response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: this.model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
    }
    if (scripted.toolCalls) for (const [index, call] of scripted.toolCalls.entries()) response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: this.model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id ?? `call_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } }] }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: this.model, choices: [{ index: 0, delta: {}, finish_reason: scripted.finishReason ?? (scripted.toolCalls ? "tool_calls" : "stop") }], usage: scripted.usage ?? { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { value += chunk; });
    request.on("end", () => resolve(value));
    request.on("error", reject);
  });
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 4) chunks.push(text.slice(index, index + 4));
  return chunks;
}
