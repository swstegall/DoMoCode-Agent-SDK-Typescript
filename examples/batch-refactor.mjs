import { DoMoCodeClient } from "../dist/index.js";
import { launchServer } from "../dist/node/launcher.js";

const prompts = process.argv.slice(2);
if (prompts.length === 0) throw new Error("Pass one or more refactor prompts as arguments.");

const server = await launchServer({
  ...(process.env.DOMO_BIN ? { command: process.env.DOMO_BIN } : {}),
  model: process.env.DOMO_MODEL ?? "mock-model",
  maxTurns: 12,
  trust: true
});
const client = new DoMoCodeClient({ baseURL: server.baseURL, token: server.token, owner: "batch-refactor" });
try {
  const session = await client.sessions.create({ authority: "require" });
  for (const prompt of prompts) {
    const result = await session.run(prompt, { maxIdleMs: 60_000 });
    console.log(JSON.stringify({ prompt, stopReason: result.stopReason, messageCount: result.messages.length }));
  }
} finally {
  await client.close();
  await server.close();
}
