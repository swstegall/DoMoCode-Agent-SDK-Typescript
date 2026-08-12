import { connect } from "../dist/node/launcher.js";

const client = await connect({ baseURL: required("DOMO_URL"), token: required("DOMO_TOKEN"), owner: "question-policy-bot" });
try {
  const session = await client.sessions.create({ authority: "require" });
  session.onInteraction(async (ask) => {
    if (ask.kind === "question") {
      const answers = ask.questions.map((question) => ({
        selectedLabels: question.allowsMultiple ? question.options.map((option) => option.label) : [question.options[0]?.label ?? ""]
      }));
      await ask.answer(answers);
      return;
    }
    if (ask.kind === "permission") {
      await ask.deny("The automated policy bot only answers structured questions.");
      return;
    }
    return "decline";
  });
  const result = await session.run(process.env.PROMPT ?? "Ask for the structured choices needed to continue.", { maxIdleMs: 60_000 });
  console.log(await session.transcript());
  console.error(`run: ${result.stopReason}`);
} finally {
  await client.close();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
