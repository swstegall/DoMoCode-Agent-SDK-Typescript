import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
    } else if (entry.name.endsWith(".ts")) {
      const source = await readFile(path, "utf8");
      if (/from\s+["']\.\.?\/[^"']+\.js["']|import\s*\(\s*["']\.\.?\/[^"']+\.js["']/.test(source)) {
        violations.push(path);
      }
    }
  }
}

await visit(root);
if (violations.length > 0) {
  console.error(`Relative .js imports are forbidden in src/:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
