import { connect } from "../dist/node/launcher.js";

const client = await connect({ baseURL: required("DOMO_URL"), token: required("DOMO_TOKEN"), owner: "workflow-driver" });
try {
  const session = await client.sessions.create({ authority: "require" });
  const definitions = await client.workflows.list();
  const workflowId = process.env.DOMO_WORKFLOW_ID ?? definitions[0]?.id;
  if (!workflowId) throw new Error("DOMO_WORKFLOW_ID is required when the server has no workflow definitions");
  const run = await client.workflows.run(workflowId, { sessionId: session.id, input: { source: "workflow-driver" } });
  console.log(JSON.stringify({ workflowId, runId: run.id, status: run.status }, null, 2));
  const approvals = await client.workflows.approvals(workflowId, run.id);
  for (const approval of approvals) {
    const decision = process.env.DOMO_APPROVAL_DECISION ?? "deny";
    await client.workflows.decide(workflowId, run.id, approval.stage.id, decision, "Decision supplied by workflow-driver example");
  }
} finally {
  await client.close();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
