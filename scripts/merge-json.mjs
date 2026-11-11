#!/usr/bin/env node
// Git merge driver for the site's JSON files (web/content.json and
// config/allowed-emails.json), so changes made on the published site and on
// the test site combine instead of overwriting each other.
//
//   git config merge.vortexjson.driver "node scripts/merge-json.mjs %O %A %B"
//   (set in the workflows; .gitattributes picks the files)
//
// Three-way merge, key by key:
// - a value changed on one side only → that change is kept;
// - changed on both sides → the published site (main) wins;
// - lists of objects with an "id" (games) → matched by id: additions from
//   either side are kept, a removal on either side removes it;
// - lists of plain values (emails, domains) → the same, value by value.
//
// VORTEX_MAIN=ours|theirs says which side of the merge is main.

import { readFileSync, writeFileSync } from "node:fs";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);
const mainIs = process.env.VORTEX_MAIN === "theirs" ? "theirs" : "ours";

const read = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; }
};
const base = read(basePath);
const ours = read(oursPath);
const theirs = read(theirsPath);
if (ours === undefined || theirs === undefined) process.exit(1); // not JSON: let git report a conflict

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasIds = (v) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string");
const key = (x) => (isObj(x) && typeof x.id === "string" ? `id:${x.id}` : `v:${JSON.stringify(x)}`);

function merge(b, o, t) {
  if (same(o, t)) return o;
  if (same(b, o)) return t; // only theirs changed
  if (same(b, t)) return o; // only ours changed
  if (isObj(o) && isObj(t)) {
    const bb = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(o), ...Object.keys(t)])) {
      const inO = k in o, inT = k in t, inB = k in bb;
      if (inO && inT) out[k] = merge(bb[k], o[k], t[k]);
      else if (inO) { if (!(inB && same(bb[k], o[k]))) out[k] = o[k]; } // removed in theirs unless ours changed it
      else if (inT) { if (!(inB && same(bb[k], t[k]))) out[k] = t[k]; }
    }
    return out;
  }
  if (Array.isArray(o) && Array.isArray(t) && (hasIds(o) || hasIds(t) || o.concat(t).every((x) => !isObj(x)))) {
    const bArr = Array.isArray(b) ? b : [];
    const bMap = new Map(bArr.map((x) => [key(x), x]));
    const oMap = new Map(o.map((x) => [key(x), x]));
    const tMap = new Map(t.map((x) => [key(x), x]));
    // Order: main's order first, then items only the other side added.
    const [first, second] = mainIs === "ours" ? [o, t] : [t, o];
    const out = [];
    const seen = new Set();
    for (const x of [...first, ...second]) {
      const k = key(x);
      if (seen.has(k)) continue;
      seen.add(k);
      const inO = oMap.has(k), inT = tMap.has(k), inB = bMap.has(k);
      if (inO && inT) out.push(merge(bMap.get(k), oMap.get(k), tMap.get(k)));
      else if (inB) {
        // One side removed it: keep it only if the other side changed it since.
        const kept = inO ? oMap.get(k) : tMap.get(k);
        if (!same(bMap.get(k), kept)) out.push(kept);
      } else out.push(inO ? oMap.get(k) : tMap.get(k)); // newly added on one side
    }
    return out;
  }
  return mainIs === "ours" ? o : t; // both changed the same value: the published site wins
}

const result = merge(base, ours, theirs);
writeFileSync(oursPath, JSON.stringify(result, null, 2) + "\n");
