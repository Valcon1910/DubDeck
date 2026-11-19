#!/usr/bin/env node
// Add an empty Update log entry dated now to web/content.json. Run by
// "Publish test site to real site" for every real publish; you write what
// changed on the home page (owner only).
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "web/content.json";
const c = JSON.parse(readFileSync(FILE, "utf8"));
const now = new Date().toISOString();
c.updates = [{ id: `pub-${now.replace(/[^0-9]/g, "").slice(0, 14)}`, date: now, text: "" }, ...(Array.isArray(c.updates) ? c.updates : [])];
writeFileSync(FILE, JSON.stringify(c, null, 2) + "\n");
console.log(`Update log entry added for ${now}.`);
