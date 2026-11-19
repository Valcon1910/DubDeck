// The "you got in" email, written by you in Admin → Email (config/email.json),
// sent from your Gmail when the GMAIL_ADDRESS and GMAIL_APP_PASSWORD secrets
// exist. Without them, callers fall back to here.now's own invite email.
import { readFileSync } from "node:fs";

const DEFAULT = {
  subject: "You got into Vortex!",
  body: "Hi {name},\n\nGood news: you've been accepted to Vortex.\n\nOpen it here: {site}\n\nSign in with {email} and the code here.now sends you.\n\nSee you there!",
};

export function template() {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync("config/email.json", "utf8")) }; } catch { return DEFAULT; }
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function render(t, v) {
  const fill = (s) => String(s).replace(/\{(name|site|email)\}/g, (_, k) => v[k] ?? "");
  const text = fill(t.body);
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;max-width:520px">${esc(text).replace(/\n/g, "<br>")
    .replace(esc(v.site), `<a href="${esc(v.site)}">${esc(v.site)}</a>`)}</div>`;
  return { subject: fill(t.subject).replace(/[\r\n]+/g, " ").slice(0, 200), text, html };
}

export const gmailReady = () => !!(process.env.GMAIL_ADDRESS && process.env.GMAIL_APP_PASSWORD);

/** Send the email to each address; returns the ones it was sent to. */
export async function sendWelcome(emails, site, names = {}) {
  if (!gmailReady() || !emails.length) return [];
  const { default: nodemailer } = await import("nodemailer");
  const from = process.env.GMAIL_ADDRESS.trim();
  const tx = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: from, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "") } });
  const t = template();
  const sent = [];
  for (const email of emails) {
    const m = render(t, { name: names[email] || email.split("@")[0], site, email });
    try {
      await tx.sendMail({ from: `Vortex <${from}>`, to: email, ...m });
      sent.push(email);
    } catch (e) {
      console.log(`::warning::Gmail couldn't send to one address: ${String(e.message).slice(0, 200)}`);
    }
  }
  return sent;
}
