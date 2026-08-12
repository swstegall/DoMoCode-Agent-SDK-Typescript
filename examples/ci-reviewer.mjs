import { connect } from "../dist/node/launcher.js";

const client = await connect({ baseURL: required("DOMO_URL"), token: required("DOMO_TOKEN"), owner: "ci-reviewer" });
try {
  const session = await client.sessions.create({ authority: "require" });
  session.onInteraction(async (ask) => {
    if (ask.kind === "permission") {
      await ask.deny("CI review is read-only; no server-side mutation was approved.");
      return;
    }
    if (ask.kind === "question") {
      await ask.cancel();
      return;
    }
    return "decline";
  });
  const result = await session.run(process.env.REVIEW_PROMPT ?? "Review the current diff for correctness and security risks.", { maxIdleMs: 30_000 });
  console.log(JSON.stringify({ stopReason: result.stopReason, transcript: await session.transcript() }, null, 2));
} finally {
  await client.close();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
