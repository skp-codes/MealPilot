#!/usr/bin/env node
// Uploads a built library to the MealPilot site's Netlify Blobs storage.
//
//   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node tools/library/upload.mjs <output folder from build.mjs>
//
// Site ID: Netlify → MealPilot project → Project configuration → General → Project details → Project ID.
// Token:   Netlify → User settings → Applications → Personal access tokens → New access token.
// Files are gzipped. Re-running continues where it stopped. The site switches to the new version only at the end.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getStore } from "@netlify/blobs";

const DIR = process.argv[2];
const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
if (!DIR || !siteID || !token) { console.error("Usage: NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node tools/library/upload.mjs <built folder>"); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(DIR, "meta.json"), "utf8"));
const store = getStore({ name: "mp-library", siteID, token });
const v = meta.version;
const files = [];
for (const sub of ["library", "archive"]) for (const f of fs.readdirSync(path.join(DIR, sub))) if (f.endsWith(".json")) files.push(`${sub}/${f}`);
files.sort((a, b) => (a.includes("head") ? -1 : 0) - (b.includes("head") ? -1 : 0));
console.log(`Uploading version ${v}: ${files.length.toLocaleString()} files`);

const done = new Set();
let cursor;
try { for await (const page of store.list({ prefix: v + "/", paginate: true })) for (const b of page.blobs) done.add(b.key); } catch (e) { console.log("(couldn't list existing files — uploading all)", e.message); }
if (done.size) console.log(`${done.size.toLocaleString()} already uploaded — continuing`);
const todo = files.filter((f) => !done.has(`${v}/${f}`));
let n = 0, failed = 0;
async function put(f) {
  const body = zlib.gzipSync(fs.readFileSync(path.join(DIR, f)), { level: 9 });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { await store.set(`${v}/${f}`, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)); return; }
    catch (e) { if (attempt === 5) { failed++; console.error("failed", f, e.message); } else await new Promise((r) => setTimeout(r, 1000 * attempt * attempt)); }
  }
}
const CONC = 8;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (todo.length) { const f = todo.shift(); await put(f); if (++n % 250 === 0) console.log(`  ${n.toLocaleString()} / ${files.length - done.size}`); }
}));
if (failed) { console.error(`${failed} files failed — run the same command again to retry them. The site still uses the previous version.`); process.exit(1); }
await store.set(`${v}/meta.json`, JSON.stringify(meta));
await store.set("current", v);                                            // switch over
console.log(`Done. MealPilot now uses library version ${v} (${meta.library.count.toLocaleString()} recipes, ${meta.archive.count.toLocaleString()} searchable).`);
if (process.argv.includes("--delete-old")) {
  const old = new Set();
  for await (const page of store.list({ paginate: true })) for (const b of page.blobs) { const pv = b.key.split("/")[0]; if (b.key.includes("/") && pv !== v) old.add(b.key); }
  for (const k of old) await store.delete(k);
  console.log(`Removed ${old.size.toLocaleString()} files from older versions.`);
}
