import { ConformanceError, ConformanceSuite } from "../dist/testing/conformance.js";
import { ScriptedMockGateway } from "../dist/testing/gateway.js";
import { launchServer } from "../dist/node/launcher.js";

const gateway = await new ScriptedMockGateway({ model: "mock-model" }).start();
let server;
try {
  const options = {
    ...(process.env.DOMO_BIN ? { command: process.env.DOMO_BIN } : {}),
    ...(process.env.DOMO_CWD ? { cwd: process.env.DOMO_CWD } : {}),
    baseURL: gateway.baseURL,
    model: "mock-model",
    maxTurns: 2,
    timeoutMs: 60_000
  };
  server = await launchServer(options);
  const report = await new ConformanceSuite({ baseURL: server.baseURL, token: server.token, clientId: "sdk-conformance", owner: "ci" }).assert();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error instanceof ConformanceError) {
    console.error(JSON.stringify(error.report, null, 2));
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await server?.close();
  await gateway.close();
}
