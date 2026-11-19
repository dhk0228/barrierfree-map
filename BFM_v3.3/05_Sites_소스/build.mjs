import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "dist", "server");
const web = join(root, "web");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const entries = Object.create(null);

function collect(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(path, url);
    else {
      if (!entry.isFile()) throw new Error(`Unexpected asset type: ${url}`);
      if (entry.name === "LICENSE") continue;
      const type = types[extname(entry.name)];
      if (!type) throw new Error(`Missing media type: ${url}`);
      const binary = type === "image/png";
      entries[url] = binary
        ? { type, base64: readFileSync(path).toString("base64") }
        : { type, text: readFileSync(path, "utf8") };
    }
  }
}

collect(web);
mkdirSync(output, { recursive: true });
for (const name of ["index", "domain", "records"]) {
  cpSync(join(root, "worker", name + ".mjs"), join(output, name + (name === "index" ? ".js" : ".mjs")));
}
writeFileSync(join(output, "assets.mjs"), `export default ${JSON.stringify(entries)};\n`);
console.log(`Worker assembled with ${Object.keys(entries).length} web assets.`);
