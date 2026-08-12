import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../testing/fixtures/", import.meta.url));
const files = (await readdir(root)).filter((name) => name.endsWith(".json"));
for (const file of files) {
  const value = JSON.parse(await readFile(join(root, file), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") throw new Error(`Fixture ${file} is not an event object`);
  const encoded = JSON.stringify(value);
  if (/authorization\s*:\s*bearer|secret-token|api[_-]?key/i.test(encoded)) throw new Error(`Fixture ${file} contains a credential`);
}
if (files.length < 5) throw new Error("The fixture corpus is unexpectedly small.");
