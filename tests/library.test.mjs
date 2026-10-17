// Runs the library builder on generated sample data in every dataset format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("library builder: sample datasets → library + searchable archive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-lib-"));
  execFileSync("node", ["tools/library/sample.mjs", path.join(dir, "in"), "10"]);
  execFileSync("node", ["tools/library/build.mjs", path.join(dir, "in"), path.join(dir, "out"), "--target", "800", "--post-shards", "16"]);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "out", "meta.json"), "utf8"));
  assert.ok(meta.library.count >= 700 && meta.library.count <= 800, "library size " + meta.library.count);
  assert.ok(Object.keys(meta.library.byCuisine).length >= 12, "spread across cuisines");
  assert.ok(meta.archive.count > 100);
  const head = JSON.parse(fs.readFileSync(path.join(dir, "out", "library", "head.json"), "utf8"));
  const rows = JSON.parse(fs.readFileSync(path.join(dir, "out", "library", "index-0.json"), "utf8")).rows;
  const ids = new Set(rows.map((r) => r[0]));
  assert.equal(ids.size, rows.length, "no duplicate ids");
  for (const r of rows) { assert.ok(r[4] >= 1 && r[5] + r[6] > 0, "servings and times"); assert.ok(r[12].length >= 6, "matched ingredients"); }
  const shard = JSON.parse(fs.readFileSync(path.join(dir, "out", "library", "rec-0.json"), "utf8"));
  const first = shard[rows[0][0]];
  assert.ok(first && first.steps.length >= 2 && first.lines.length >= 3);
  // RecipeNLG / Recipe1M method text is never stored
  let linkOnly = 0;
  for (const f of fs.readdirSync(path.join(dir, "out", "archive")).filter((f) => f.startsWith("rec-")))
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, "out", "archive", f), "utf8"))) if (r.s === "nl" || r.s === "rm") { linkOnly++; assert.ok(!r.d && r.lo); }
  assert.ok(linkOnly > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
