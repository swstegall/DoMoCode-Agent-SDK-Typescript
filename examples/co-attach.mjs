import { connect, releaseAuthorityWhenIdle } from "../dist/node/launcher.js";

const baseURL = required("DOMO_URL");
const token = required("DOMO_TOKEN");
const sessionId = required("DOMO_SESSION_ID");
const driverClient = await connect({ baseURL, token, owner: "co-attach-driver" });
const mirrorClient = await connect({ baseURL, token, owner: "co-attach-mirror" });
try {
  const driver = await driverClient.sessions.open(sessionId, { authority: "require" });
  const mirror = await mirrorClient.sessions.open(sessionId, { authority: "observer" });
  console.log(JSON.stringify({ driverRole: driver.role, mirrorRole: mirror.role, running: (await mirror.status()).running }, null, 2));
  await releaseAuthorityWhenIdle(driver);
} finally {
  await driverClient.close();
  await mirrorClient.close();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
