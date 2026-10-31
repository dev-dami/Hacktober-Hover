// Validate the master CSVs and write data/processed/normalized-products.json.
//   bun scripts/data/normalize.ts            validate + write
//   bun scripts/data/normalize.ts --check    validate only
//   --input <csv>          strict input (repeatable): any bad row fails the run
//   --lenient-input <csv>  lenient input (repeatable): bad rows are skipped with a warning
//   --output <json> --fixture (fictional data, no source URL required)
//
// Default inputs: data/raw/greenbook-products.csv (crawled, lenient) and
// data/raw/nafdac-products.csv (hand-entered, strict). Missing default files are skipped.

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadProductsCsv, printIssues, type Issue } from "./products.ts";
import type { ProductRecord } from "./schema.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    input: { type: "string", multiple: true },
    "lenient-input": { type: "string", multiple: true },
    output: { type: "string", default: resolve(ROOT, "data/processed/normalized-products.json") },
    check: { type: "boolean", default: false },
    fixture: { type: "boolean", default: false },
    "max-issues": { type: "string", default: "40" },
  },
});

const explicit = !!(values.input?.length || values["lenient-input"]?.length);
const inputs = explicit
  ? [
      ...(values["lenient-input"] ?? []).map((path) => ({ path, strict: false })),
      ...(values.input ?? []).map((path) => ({ path, strict: true })),
    ]
  : [
      { path: resolve(ROOT, "data/raw/greenbook-products.csv"), strict: false },
      { path: resolve(ROOT, "data/raw/nafdac-products.csv"), strict: true },
    ];

const records: ProductRecord[] = [];
const fileOf = new Map<string, string>(); // registration number -> first file it appeared in
let errors = 0;
let warnings = 0;

for (const { path: input, strict } of inputs) {
  const file = Bun.file(input);
  if (!(await file.exists())) {
    if (explicit) {
      console.error(`ERROR: ${input} does not exist`);
      process.exit(1);
    }
    console.log(`Skipping ${input} (not found)`);
    continue;
  }
  const loaded = loadProductsCsv(await file.text(), { fixture: values.fixture, strict });
  const issues: Issue[] = [...loaded.issues];

  for (const record of loaded.records) {
    const firstFile = fileOf.get(record.registrationNumber);
    if (firstFile && firstFile !== input) {
      issues.push({
        level: "warning",
        row: 0,
        message: `${record.registrationNumber} (${record.productName}) also appears in ${firstFile}; both kept`,
      });
    }
    if (!firstFile) fileOf.set(record.registrationNumber, input);
    records.push(record);
  }

  const fileErrors = issues.filter((i) => i.level === "error");
  const fileWarnings = issues.filter((i) => i.level === "warning");
  const max = Number(values["max-issues"]);
  printIssues([...fileErrors.slice(0, max), ...fileWarnings.slice(0, max)]);
  const hidden = Math.max(0, fileErrors.length - max) + Math.max(0, fileWarnings.length - max);
  if (hidden) console.log(`… ${hidden} more issue(s) not shown (raise --max-issues)`);
  console.log(
    `${loaded.records.length} valid record(s), ${fileErrors.length} error(s), ${fileWarnings.length} warning(s) in ${input}`,
  );
  errors += fileErrors.length;
  warnings += fileWarnings.length;
}

console.log(`Total: ${records.length} record(s), ${errors} error(s), ${warnings} warning(s)`);
if (errors > 0) process.exit(1);

if (!values.check) {
  await mkdir(dirname(values.output), { recursive: true });
  await Bun.write(values.output, `${JSON.stringify(records, null, 1)}\n`);
  console.log(`Wrote ${values.output}`);
}
