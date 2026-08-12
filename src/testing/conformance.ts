import { DoMoCodeClient } from "../client.ts";
import type { FetchFunction } from "../transport.ts";

export type ConformanceCheckStatus = "passed" | "failed" | "skipped";

export interface ConformanceCheck {
  name: string;
  status: ConformanceCheckStatus;
  durationMs: number;
  detail?: string;
}

export interface ConformanceReport {
  passed: boolean;
  checks: ConformanceCheck[];
  protocolVersion?: number;
  sessionId?: string;
}

export interface ConformanceSuiteOptions {
  baseURL: string;
  token: string;
  fetch?: FetchFunction;
  clientId?: string;
  owner?: string;
}

export class ConformanceError extends Error {
  constructor(public readonly report: ConformanceReport) {
    const failed = report.checks.filter((check) => check.status === "failed").map((check) => check.name).join(", ");
    super(`DoMoCode conformance failed${failed.length === 0 ? "." : `: ${failed}`}`);
    this.name = "ConformanceError";
  }
}

/**
 * A small, read-safe protocol smoke suite for a running DoMoCode server.
 *
 * The suite creates and disposes one session, but never starts a model turn by
 * default. This makes it suitable for CI against a server configured with a
 * scripted gateway as well as for diagnosing a remote deployment without
 * consuming model quota. It deliberately uses only the public client surface.
 */
export class ConformanceSuite {
  private readonly options: ConformanceSuiteOptions;

  constructor(options: ConformanceSuiteOptions) {
    if (!options.baseURL) throw new TypeError("ConformanceSuite baseURL is required");
    if (!options.token) throw new TypeError("ConformanceSuite token is required");
    this.options = { ...options };
  }

  async run(): Promise<ConformanceReport> {
    const checks: ConformanceCheck[] = [];
    const client = new DoMoCodeClient({
      baseURL: this.options.baseURL,
      token: this.options.token,
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.clientId === undefined ? {} : { clientId: this.options.clientId }),
      ...(this.options.owner === undefined ? {} : { owner: this.options.owner })
    });
    let protocolVersion: number | undefined;
    let sessionId: string | undefined;
    let session: Awaited<ReturnType<typeof client.sessions.create>> | undefined;

    try {
      const capabilities = await this.check(checks, "capabilities", async () => {
        const value = await client.capabilities();
        if (value === undefined) return { skipped: "GET /capabilities is not available" };
        protocolVersion = value.protocolVersion;
        if (value.protocolVersion !== 1) throw new Error(`Unsupported protocol version ${value.protocolVersion}`);
        return { detail: `${value.capabilities.length} capabilities advertised` };
      });
      if (capabilities.status === "failed") this.skip(checks, "session create", "capabilities check failed");

      const created = await this.check(checks, "session create", async () => {
        session = await client.sessions.create({ authority: "prefer" });
        sessionId = session.id;
        return { detail: session.id };
      });
      if (created.status === "failed") {
        for (const name of ["event stream", "session status", "tool catalog", "transcript reads"]) this.skip(checks, name, "session could not be created");
        return { passed: false, checks, ...(protocolVersion === undefined ? {} : { protocolVersion }) };
      }

      await this.check(checks, "event stream", async () => {
        await session!.events().waitForConnected();
        return { detail: `protocol v${session!.eventsEngine?.stats.connected === undefined ? 1 : protocolVersion ?? 1}` };
      });
      await this.check(checks, "session status", async () => {
        const status = await session!.status();
        if (status.sessionId !== session!.id || status.running) throw new Error("new session did not report idle status");
        return { detail: "idle session observed" };
      });
      await this.check(checks, "tool catalog", async () => {
        const tools = await session!.tools();
        return { detail: `${tools.length} tools decoded` };
      });
      await this.check(checks, "transcript reads", async () => {
        const [messages, context] = await Promise.all([session!.messages(), session!.context()]);
        if (!Array.isArray(messages) || !Array.isArray(context.messages)) throw new Error("transcript payload was not an array");
        return { detail: `${messages.length} messages decoded` };
      });
    } finally {
      await client.close();
    }

    return {
      passed: checks.every((check) => check.status !== "failed"),
      checks,
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
      ...(sessionId === undefined ? {} : { sessionId })
    };
  }

  async assert(): Promise<ConformanceReport> {
    const report = await this.run();
    if (!report.passed) throw new ConformanceError(report);
    return report;
  }

  private async check(
    checks: ConformanceCheck[],
    name: string,
    operation: () => Promise<{ detail?: string; skipped?: string }>
  ): Promise<ConformanceCheck> {
    const started = Date.now();
    try {
      const result = await operation();
      const check: ConformanceCheck = {
        name,
        status: result.skipped === undefined ? "passed" : "skipped",
        durationMs: Date.now() - started,
        ...(result.detail === undefined && result.skipped === undefined ? {} : { detail: result.detail ?? result.skipped })
      };
      checks.push(check);
      return check;
    } catch (error) {
      const check: ConformanceCheck = {
        name,
        status: "failed",
        durationMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error)
      };
      checks.push(check);
      return check;
    }
  }

  private skip(checks: ConformanceCheck[], name: string, detail: string): void {
    checks.push({ name, status: "skipped", durationMs: 0, detail });
  }
}
