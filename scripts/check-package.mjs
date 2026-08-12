import { readFile } from "node:fs/promises";

const packageJSON = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const forbidden = ["prepare", "prepack", "install", "postinstall", "preinstall"];
const scripts = packageJSON.scripts ?? {};
const found = forbidden.filter((name) => name in scripts);
if (found.length > 0) {
  console.error(`Lifecycle scripts are forbidden: ${found.join(", ")}`);
  process.exitCode = 1;
}
if (Object.keys(packageJSON.dependencies ?? {}).length > 0) {
  console.error("Runtime dependencies are forbidden; use the platform fetch and streams APIs.");
  process.exitCode = 1;
}
