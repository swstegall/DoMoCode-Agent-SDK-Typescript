import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const missing = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".test-dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith(".md")) checkFile(path, await readFile(path, "utf8"));
  }
}

function checkFile(path, source) {
  const relativeLinks = /(?:\[[^\]]*\]|\([^)]*\))\(([^)]+)\)/g;
  for (const match of source.matchAll(relativeLinks)) {
    const target = match[1]?.split("#", 1)[0]?.trim();
    if (!target || target.startsWith("http:") || target.startsWith("https:") || target.startsWith("mailto:") || target.startsWith("<")) continue;
    const clean = target.replace(/^<|>$/g, "");
    if (clean === "../DOMOCODE_SDK_PLAN.md") continue;
    const resolved = resolve(dirname(path), clean);
    if (!existsSync(resolved)) missing.push(`${path}: ${clean}`);
  }
}

await visit(root);
if (missing.length > 0) {
  console.error(`Missing local documentation links:\n${missing.join("\n")}`);
  process.exitCode = 1;
}
