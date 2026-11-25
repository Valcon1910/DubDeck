// Checks Chat's privacy rules against a local Supabase (npx supabase start,
// npx supabase functions serve). Run from web/: node ../supabase/tests/chat.test.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const FN = process.env.CHAT_FN ?? "http://127.0.0.1:54321/functions/v1/vortex-login";
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";

async function login(email) {
  const r = await fetch(FN, { method: "POST", headers: { "x-vortex-secret": SECRET, "x-vortex-email": email } });
  const s = await r.json();
  assert.ok(s.access_token, `login ${email}: ${JSON.stringify(s)}`);
  const sb = createClient(s.url, s.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  return sb;
}
const ok = ({ data, error }) => { assert.equal(error, null, error?.message); return data; };
const bad = ({ error }, why) => assert.ok(error, `expected failure: ${why}`);

const [ann, bob, cy, own] = await Promise.all(["ann@x.test", "bob@x.test", "cy@x.test", "own@x.test"].map(login));
const anon = createClient("http://127.0.0.1:54321", (await (await fetch(FN, { method: "POST", headers: { "x-vortex-secret": SECRET, "x-vortex-email": "ann@x.test" } })).json()).anonKey);

// Direct chat, reused when opened again from either side.
const dm = ok(await ann.rpc("create_conversation", { p_kind: "dm", p_members: ["bob@x.test"] }));
assert.equal(ok(await bob.rpc("create_conversation", { p_kind: "dm", p_members: ["ANN@x.test"] })), dm);
bad(await ann.rpc("create_conversation", { p_kind: "dm", p_members: ["stranger@x.test"] }), "non-member");

// Sender can't be faked; outsiders can't read or post.
const m1 = ok(await ann.from("messages").insert({ conversation_id: dm, body: "hi bob", sender: "bob@x.test" }).select().single());
assert.equal(m1.sender, "ann@x.test");
assert.equal(ok(await cy.from("messages").select().eq("conversation_id", dm)).length, 0);
bad(await cy.from("messages").insert({ conversation_id: dm, body: "sneaky" }), "outsider post");
bad(await anon.from("messages").select(), "anonymous read");
assert.equal(ok(await cy.from("conversations").select()).length, 0);

// Unread counts.
let list = ok(await bob.rpc("my_conversations"));
assert.equal(list[0].unread, 1); assert.equal(list[0].last_body, "hi bob");
ok(await bob.rpc("mark_read", { p_id: dm }));
assert.equal(ok(await bob.rpc("my_conversations"))[0].unread, 0);
assert.equal(ok(await ann.rpc("my_conversations"))[0].unread, 0);

// Edit own, not others'; deleting clears text.
ok(await ann.from("messages").update({ body: "hi bob!" }).eq("id", m1.id));
assert.ok(ok(await ann.from("messages").select().eq("id", m1.id).single()).edited_at);
await bob.from("messages").update({ body: "hacked" }).eq("id", m1.id);
assert.equal(ok(await ann.from("messages").select().eq("id", m1.id).single()).body, "hi bob!");
bad(await ann.from("messages").update({ sender: "bob@x.test" }).eq("id", m1.id), "change sender");

// Groups: admin manages, members can't; leaving promotes someone.
const g = ok(await ann.rpc("create_conversation", { p_kind: "group", p_members: ["bob@x.test"], p_name: "Squad" }));
bad(await bob.rpc("add_members", { p_id: g, p_members: ["cy@x.test"] }), "member adds");
ok(await ann.rpc("add_members", { p_id: g, p_members: ["cy@x.test"] }));
ok(await cy.from("messages").insert({ conversation_id: g, body: "hey all" }));
bad(await bob.rpc("update_group", { p_id: g, p_name: "Mine", p_icon: "" }), "member renames");
ok(await ann.rpc("update_group", { p_id: g, p_name: "Squad 2", p_icon: "" }));
bad(await bob.rpc("remove_member", { p_id: g, p_email: "cy@x.test" }), "member removes");
ok(await ann.rpc("remove_member", { p_id: g, p_email: "ann@x.test" }));
const roles = ok(await bob.from("participants").select("email, role").eq("conversation_id", g));
assert.equal(roles.length, 2); assert.ok(roles.some((r) => r.role === "admin"));
assert.equal(ok(await ann.from("messages").select().eq("conversation_id", g)).length, 0);

// Files: members of the conversation only.
const path = `${g}/test.txt`;
ok(await bob.storage.from("chat").upload(path, new Blob(["secret file"]), { contentType: "text/plain" }));
bad(await ann.storage.from("chat").upload(`${g}/x.txt`, new Blob(["x"])), "ex-member upload");
bad(await ann.storage.from("chat").download(path), "ex-member download");
assert.equal(await (ok(await cy.storage.from("chat").download(path))).text(), "secret file");
ok(await ann.storage.from("pics").upload(`ann@x.test/${Date.now()}.png`, new Blob(["png"], { type: "image/png" })));
bad(await ann.storage.from("pics").upload(`bob@x.test/me.png`, new Blob(["png"], { type: "image/png" })), "other's pic");

// Profiles: own name only.
ok(await ann.from("profiles").update({ name: "Annie" }).eq("email", "ann@x.test"));
await ann.from("profiles").update({ name: "Bobby" }).eq("email", "bob@x.test");
bad(await ann.from("profiles").update({ member: true }).eq("email", "ann@x.test"), "change member flag");
const ps = ok(await ann.from("profiles").select().in("email", ["ann@x.test", "bob@x.test"]));
assert.deepEqual(ps.map((p) => p.name).sort(), ["Annie", "Bob"]);

// Owner moderates: reads everything, deletes others' messages, deletes groups.
assert.ok(ok(await own.from("messages").select().eq("conversation_id", dm)).length >= 1);
ok(await own.from("messages").update({ deleted: true }).eq("id", m1.id));
assert.equal(ok(await ann.from("messages").select().eq("id", m1.id).single()).body, "");
bad(await bob.rpc("delete_conversation", { p_id: dm }), "delete dm");
ok(await own.rpc("delete_conversation", { p_id: g }));
assert.equal(ok(await bob.from("conversations").select().eq("id", g)).length, 0);

// Live updates: Bob hears Ann's new message.
const heard = new Promise((res) => {
  bob.channel("t").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => res(p.new.body)).subscribe(async (st) => {
    if (st === "SUBSCRIBED") { await new Promise((r) => setTimeout(r, 2500)); await ann.from("messages").insert({ conversation_id: dm, body: "live!" }); }
  });
});
assert.equal(await Promise.race([heard, new Promise((r) => setTimeout(() => r("timeout"), 8000))]), "live!");

// Typing signals: members hear them, outsiders can't even join.
const join = (sb, topic) => new Promise((res) => {
  const ch = sb.channel(topic, { config: { private: true } });
  ch.subscribe((st) => { if (st !== "SUBSCRIBED" && st !== "CLOSED") res([st, ch]); if (st === "SUBSCRIBED") res([st, ch]); });
  setTimeout(() => res(["TIMEOUT", ch]), 8000);
});
const [cyState] = await join(cy, `typing:${dm}`);
assert.notEqual(cyState, "SUBSCRIBED", "outsider joined a typing channel");
const [bobState, bobCh] = await join(bob, `typing:${dm}`);
assert.equal(bobState, "SUBSCRIBED");
const typed = new Promise((res) => bobCh.on("broadcast", { event: "typing" }, (m) => res(m.payload.email)));
const [, annCh] = await join(ann, `typing:${dm}`);
await annCh.send({ type: "broadcast", event: "typing", payload: { email: "ann@x.test" } });
assert.equal(await Promise.race([typed, new Promise((r) => setTimeout(() => r("timeout"), 5000))]), "ann@x.test");

// Reactions: members react as themselves, once per emoji; outsiders can't see or add.
const rm = ok(await ann.from("messages").insert({ conversation_id: dm, body: "react to me" }).select().single());
ok(await bob.from("message_reactions").insert({ message_id: rm.id, conversation_id: dm, emoji: "🔥", email: "ann@x.test" }));
const rs = ok(await ann.from("message_reactions").select("*").eq("message_id", rm.id));
assert.deepEqual(rs.map((r) => [r.email, r.emoji]), [["bob@x.test", "🔥"]], "reaction stamped with the real sender");
bad(await bob.from("message_reactions").insert({ message_id: rm.id, conversation_id: dm, emoji: "🔥" }), "duplicate reaction");
bad(await cy.from("message_reactions").insert({ message_id: rm.id, conversation_id: dm, emoji: "👍" }), "outsider reaction");
assert.equal(ok(await cy.from("message_reactions").select("*").eq("message_id", rm.id)).length, 0, "outsider sees reactions");
bad(await cy.from("message_reactions").insert({ message_id: rm.id, conversation_id: g, emoji: "👍" }), "reaction pointing at another chat");
ok(await ann.from("message_reactions").delete().match({ message_id: rm.id, email: "bob@x.test" }));
assert.equal(ok(await bob.from("message_reactions").select("*").eq("message_id", rm.id)).length, 1, "someone else removed my reaction");
ok(await bob.from("message_reactions").delete().match({ message_id: rm.id, emoji: "🔥" }));
assert.equal(ok(await bob.from("message_reactions").select("*").eq("message_id", rm.id)).length, 0);

console.log("Chat rules: all checks passed");
process.exit(0);
