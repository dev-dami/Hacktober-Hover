// Validate data/raw/nafdac-products.csv and write data/processed/normalized-products.json.
//   bun scripts/data/normalize.ts            validate + write
//   bun scripts/data/normalize.ts --check    validate only
//   --input <csv> --output <json> --fixture  (fixture: fictional data, no source URL required)

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadProductsCsv, printIssues } from "./products.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    input: { type: "string", default: resolve(ROOT, "data/raw/nafdac-products.csv") },
    output: { type: "string", default: resolve(ROOT, "data/processed/normalized-products.json") },
    check: { type: "boolean", default: false },
    fixture: { type: "boolean", default: false },
  },
});

const { records, issues } = loadProductsCsv(await Bun.file(values.input).text(), { fixture: values.fixture });
printIssues(issues);

const errors = issues.filter((i) => i.level === "error").length;
const warnings = issues.length - errors;
console.log(`${records.length} valid record(s), ${errors} error(s), ${warnings} warning(s) in ${values.input}`);
if (errors > 0) process.exit(1);

if (!values.check) {
  await mkdir(dirname(values.output), { recursive: true });
  await Bun.write(values.output, `${JSON.stringify(records, null, 2)}\n`);
  console.log(`Wrote ${values.output}`);
}
