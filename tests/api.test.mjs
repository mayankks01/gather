import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { HubConnectionBuilder, LogLevel } = require("@microsoft/signalr");
const base = process.env.GATHER_TEST_URL || "http://localhost:5080";
const nonce = Date.now().toString(36);
let owner, member, outsider, room, channel, sent, invite;
const connections = [];
async function request(path, { user, method = "GET", body, cookie } = {}) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Gather-Client": "web",
      ...(user ? { Authorization: "Bearer " + user.accessToken } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result =
    response.status === 204 ? null : await response.json().catch(() => null);
  return {
    response,
    status: response.status,
    result,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(label) {
  const response = await request("/auth/register", {
    method: "POST",
    body: {
      username: label + nonce,
      displayName: label + " Test",
      email: label + nonce + "@example.test",
      password: "Test-only.long-pass123!",
      ageConfirmed: true,
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.result));
  return { ...response.result, cookie: response.cookie };
}
async function connect(user) {
  const hub = new HubConnectionBuilder()
    .withUrl(base + "/hubs/chat", {
      accessTokenFactory: () => user.accessToken,
    })
    .configureLogging(LogLevel.None)
    .build();
  await hub.start();
  connections.push(hub);
  return hub;
}
before(async () => {
  owner = await register("owner");
  member = await register("member");
  outsider = await register("other");
  const created = await request("/rooms", {
    user: owner,
    method: "POST",
    body: {
      name: "Integration " + nonce,
      description: "Temporary test room",
      isPrivate: true,
      color: "#6554c0",
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.result));
  room = created.result.id;
  channel = created.result.channelId;
});
after(async () => {
  await Promise.all(connections.map((c) => c.stop()));
  if (room)
    await request(
      `/rooms/${room}?confirmation=${encodeURIComponent("Integration " + nonce)}`,
      { user: owner, method: "DELETE" },
    );
});
test("unauthenticated requests are rejected", async () => {
  assert.equal((await request("/rooms")).status, 401);
});
test("private room history and joining require membership", async () => {
  assert.equal(
    (await request(`/channels/${channel}/messages`, { user: outsider })).status,
    403,
  );
  assert.equal(
    (await request(`/rooms/${room}/join`, { user: outsider, method: "POST" }))
      .status,
    403,
  );
});
test("private rooms are absent from discovery", async () => {
  const r = await request("/rooms/discover", { user: outsider });
  assert.equal(r.status, 200);
  assert.ok(!r.result.some((r) => r.id === room));
});
test("invite joins a member and honors max uses", async () => {
  const r = await request(`/rooms/${room}/invites`, {
    user: owner,
    method: "POST",
    body: { hours: 24, maxUses: 1 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.result));
  invite = r.result.code;
  assert.equal(
    (
      await request(`/invites/${invite}/accept`, {
        user: member,
        method: "POST",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/invites/${invite}/accept`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    400,
  );
});
test("member cannot edit room or assign roles", async () => {
  assert.equal(
    (
      await request(`/rooms/${room}`, {
        user: member,
        method: "PATCH",
        body: {
          name: "Hacked",
          description: "",
          isPrivate: false,
          color: "#6554c0",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/rooms/${room}/members/${owner.user.id}`, {
        user: member,
        method: "PATCH",
        body: { role: "Member" },
      })
    ).status,
    403,
  );
});
test("SignalR delivery, retries, edits, and persistent history", async () => {
  const a = await connect(owner);
  const b = await connect(member);
  await b.invoke("SubscribeChannel", channel);
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Message delivery timed out")),
      5000,
    );
    b.on("MessageCreated", (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
  const input = {
    channelId: channel,
    content: "Hello from the integration test",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  };
  sent = await a.invoke("SendMessage", input);
  assert.equal((await delivered).id, sent.id);
  assert.equal((await a.invoke("SendMessage", input)).id, sent.id);
  await a.invoke("EditMessage", sent.id, "Edited content");
  const history = await request(`/channels/${channel}/messages`, {
    user: member,
  });
  assert.equal(history.status, 200, JSON.stringify(history.result));
  assert.equal(history.result.messages.length, 1);
  assert.equal(history.result.messages[0].content, "Edited content");
  assert.ok(history.result.messages[0].editedAt);
  await assert.rejects(() =>
    b.invoke("EditMessage", sent.id, "Unauthorized edit"),
  );
});
test("outsider cannot subscribe or send to private channel", async () => {
  const c = await connect(outsider);
  await assert.rejects(() => c.invoke("SubscribeChannel", channel));
  await assert.rejects(() =>
    c.invoke("SendMessage", {
      channelId: channel,
      content: "No access",
      clientMessageId: crypto.randomUUID(),
      attachmentIds: [],
    }),
  );
});
test("read marker clears unread counts", async () => {
  const before = await request("/rooms", { user: member });
  assert.equal(before.result.find((r) => r.id === room).unread, 1);
  assert.equal(
    (
      await request(`/channels/${channel}/read/${sent.id}`, {
        user: member,
        method: "POST",
      })
    ).status,
    204,
  );
  const after = await request("/rooms", { user: member });
  assert.equal(after.result.find((r) => r.id === room).unread, 0);
});
test("direct conversations are unique per pair", async () => {
  const a = await request("/dm/" + member.user.username, {
    user: owner,
    method: "POST",
  });
  const b = await request("/dm/" + owner.user.username, {
    user: member,
    method: "POST",
  });
  assert.equal(a.status, 200);
  assert.equal(a.result.channelId, b.result.channelId);
});
test("blocking prevents DM sends and history access", async () => {
  const d = await request("/dm/" + member.user.username, {
    user: owner,
    method: "POST",
  });
  await request("/blocks/" + member.user.id, { user: owner, method: "POST" });
  assert.equal(
    (
      await request(`/channels/${d.result.channelId}/messages`, {
        user: member,
      })
    ).status,
    403,
  );
  await assert.rejects(() =>
    connections[1].invoke("SendMessage", {
      channelId: d.result.channelId,
      content: "Blocked",
      clientMessageId: crypto.randomUUID(),
      attachmentIds: [],
    }),
  );
  await request("/blocks/" + member.user.id, { user: owner, method: "DELETE" });
});
test("renamed executable cannot be uploaded as video", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["MZ executable payload"], { type: "video/mp4" }),
    "fake.mp4",
  );
  const response = await fetch(base + "/api/v1/media/" + channel, {
    method: "POST",
    headers: { Authorization: "Bearer " + owner.accessToken },
    body: form,
  });
  assert.equal(response.status, 400);
});
test("revoked invitations cannot be used", async () => {
  const r = await request(`/rooms/${room}/invites`, {
    user: owner,
    method: "POST",
    body: { hours: 1, maxUses: 10 },
  });
  await request(`/rooms/${room}/invites/${r.result.code}`, {
    user: owner,
    method: "DELETE",
  });
  assert.equal(
    (
      await request(`/invites/${r.result.code}/accept`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    404,
  );
});
test("replies persist, follow edits, deduplicate, and reject cross-channel parents", async () => {
  const input = {
    channelId: channel,
    content: "Reply needle",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
    replyToId: sent.id,
  };
  const reply = await connections[1].invoke("SendMessage", input);
  assert.equal(reply.replyTo.id, sent.id);
  assert.equal(reply.replyTo.content, "Edited content");
  assert.equal(
    (await connections[1].invoke("SendMessage", input)).id,
    reply.id,
  );
  await connections[0].invoke("EditMessage", sent.id, "Updated parent");
  const history = await request(`/channels/${channel}/messages`, {
    user: member,
  });
  assert.equal(
    history.result.messages.find((m) => m.id === reply.id).replyTo.content,
    "Updated parent",
  );
  const dm = await request("/dm/" + member.user.username, {
    user: owner,
    method: "POST",
  });
  await assert.rejects(() =>
    connections[0].invoke("SendMessage", {
      ...input,
      clientMessageId: crypto.randomUUID(),
      channelId: dm.result.channelId,
    }),
  );
});

test("reactions are idempotent, shared in real time, and removable only by their author", async () => {
  const path = `/messages/${sent.id}/reactions`;
  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Reaction update timed out")),
      5000,
    );
    const handler = (message) => {
      if (message.id === sent.id && message.reactions?.length) {
        clearTimeout(timeout);
        connections[1].off("MessageUpdated", handler);
        resolve(message);
      }
    };
    connections[1].on("MessageUpdated", handler);
  });
  const first = await request(path, {
    user: owner,
    method: "PUT",
    body: { emoji: "🚀" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.result));
  assert.equal((await received).reactions[0].count, 1);
  const duplicate = await request(path, {
    user: owner,
    method: "PUT",
    body: { emoji: "🚀" },
  });
  assert.equal(duplicate.result.reactions[0].count, 1);
  await request(path, { user: member, method: "PUT", body: { emoji: "🚀" } });
  const removed = await request(path + "?emoji=" + encodeURIComponent("🚀"), {
    user: member,
    method: "DELETE",
  });
  assert.equal(removed.result.reactions[0].count, 1);
  assert.equal(removed.result.reactions[0].users[0].id, owner.user.id);
  assert.equal(
    (
      await request(path, {
        user: outsider,
        method: "PUT",
        body: { emoji: "🚀" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(path, {
        user: owner,
        method: "PUT",
        body: { emoji: "not emoji" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT", body: { emoji: "⭐" } }))
      .status,
    200,
  );
});

test("pinning requires a room moderation role and private pins stay private", async () => {
  const path = `/messages/${sent.id}/pin`;
  assert.equal(
    (await request(path, { user: member, method: "PUT" })).status,
    403,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT" })).result.pinned,
    true,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT" })).result.pinned,
    true,
  );
  assert.equal(
    (await request(`/channels/${channel}/pins`, { user: member })).result
      .length,
    1,
  );
  assert.equal(
    (await request(`/channels/${channel}/pins`, { user: outsider })).status,
    403,
  );
  assert.equal(
    (await request(path, { user: member, method: "DELETE" })).status,
    403,
  );
  assert.equal(
    (await request(path, { user: owner, method: "DELETE" })).result.pinned,
    false,
  );
});

test("search filters and context respect channel membership", async () => {
  const path = `/channels/${channel}/messages/search`;
  const found = await request(
    path + "?q=NEEDLE&sender=" + member.user.username,
    { user: owner },
  );
  assert.equal(found.status, 200, JSON.stringify(found.result));
  assert.equal(found.result.messages.length, 1);
  assert.equal(found.result.messages[0].content, "Reply needle");
  assert.equal(
    (
      await request(path + "?q=needle&sender=" + owner.user.username, {
        user: owner,
      })
    ).result.messages.length,
    0,
  );
  assert.equal(
    (await request(path + "?from=" + (Date.now() + 60000), { user: owner }))
      .result.messages.length,
    0,
  );
  assert.equal(
    (await request(path + "?hasMedia=true", { user: owner })).result.messages
      .length,
    0,
  );
  assert.equal(
    (await request(path + "?before=" + sent.id, { user: owner })).result
      .messages.length,
    0,
  );
  assert.equal(
    (await request(path + "?from=10&until=1", { user: owner })).status,
    400,
  );
  assert.equal((await request(path, { user: outsider })).status, 403);
  const context = `/channels/${channel}/messages/${sent.id}/context`;
  assert.ok(
    (await request(context, { user: member })).result.messages.some(
      (m) => m.id === sent.id,
    ),
  );
  assert.equal((await request(context, { user: outsider })).status, 403);
});

test("deletion removes pins and reactions, hides search content, and sanitizes replies", async () => {
  await request(`/messages/${sent.id}/pin`, { user: owner, method: "PUT" });
  await connections[0].invoke("DeleteMessage", sent.id);
  const history = (
    await request(`/channels/${channel}/messages`, { user: member })
  ).result.messages;
  const deleted = history.find((m) => m.id === sent.id);
  assert.equal(deleted.content, "");
  assert.equal(deleted.pinned, false);
  assert.deepEqual(deleted.reactions, []);
  const quote = history.find((m) => m.replyTo?.id === sent.id).replyTo;
  assert.equal(quote.deleted, true);
  assert.equal(quote.content, "This message was deleted.");
  assert.equal(
    (await request(`/channels/${channel}/pins`, { user: owner })).result.length,
    0,
  );
  assert.equal(
    (
      await request(`/channels/${channel}/messages/search?q=Updated`, {
        user: owner,
      })
    ).result.messages.length,
    0,
  );
  assert.equal(
    (
      await request(`/messages/${sent.id}/reactions`, {
        user: member,
        method: "PUT",
        body: { emoji: "🚀" },
      })
    ).status,
    400,
  );
});

test("timed mutes enforce hierarchy and block writes while preserving read access", async () => {
  const path = `/rooms/${room}/members/${member.user.id}/mute`;
  assert.equal(
    (await request(path, { user: member, method: "PUT", body: { minutes: 5 } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(path, {
        user: outsider,
        method: "PUT",
        body: { minutes: 5 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT", body: { minutes: -1 } }))
      .status,
    400,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT", body: { minutes: 5 } }))
      .status,
    204,
  );
  const list = await request(`/rooms/${room}/members`, { user: member });
  const muted = list.result.find((m) => m.id === member.user.id);
  assert.ok(
    muted.mutedUntil > Date.now() && muted.mutedUntil <= Date.now() + 300000,
  );
  assert.equal(
    (await request(`/channels/${channel}/messages`, { user: member })).status,
    200,
  );
  const input = {
    channelId: channel,
    content: "Muted message",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  };
  await assert.rejects(() => connections[1].invoke("SendMessage", input));
  assert.equal(
    (await request(path, { user: member, method: "PUT", body: { minutes: 0 } }))
      .status,
    403,
  );
  assert.equal(
    (await request(path, { user: owner, method: "PUT", body: { minutes: 0 } }))
      .status,
    204,
  );
  const posted = await connections[1].invoke("SendMessage", input);
  assert.equal(posted.content, input.content);
  await request(`/rooms/${room}/members/${member.user.id}`, {
    user: owner,
    method: "PATCH",
    body: { role: "Moderator" },
  });
  assert.equal(
    (
      await request(`/rooms/${room}/members/${owner.user.id}/mute`, {
        user: member,
        method: "PUT",
        body: { minutes: 5 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(path, { user: member, method: "PUT", body: { minutes: 5 } }))
      .status,
    403,
  );
  await request(`/rooms/${room}/members/${member.user.id}`, {
    user: owner,
    method: "PATCH",
    body: { role: "Member" },
  });
});

test("deleted messages do not keep unread badges active", async () => {
  const message = await connections[0].invoke("SendMessage", {
    channelId: channel,
    content: "Temporary unread",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  });
  const before = await request("/rooms", { user: member });
  assert.equal(before.result.find((r) => r.id === room).unread, 1);
  await connections[0].invoke("DeleteMessage", message.id);
  const after = await request("/rooms", { user: member });
  assert.equal(after.result.find((r) => r.id === room).unread, 0);
});

test("ban removes membership and blocks future invites", async () => {
  const r = await request(`/rooms/${room}/invites`, {
    user: owner,
    method: "POST",
    body: { hours: 1, maxUses: 10 },
  });
  assert.equal(
    (
      await request(`/rooms/${room}/bans/${member.user.id}`, {
        user: owner,
        method: "POST",
        body: { reason: "Test ban" },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await request(`/invites/${r.result.code}/accept`, {
        user: member,
        method: "POST",
      })
    ).status,
    403,
  );
  await assert.rejects(() =>
    connections[1].invoke("SendMessage", {
      channelId: channel,
      content: "After ban",
      clientMessageId: crypto.randomUUID(),
      attachmentIds: [],
    }),
  );
});
test("refresh rotates and detects token reuse", async () => {
  const first = await request("/auth/refresh", {
    method: "POST",
    cookie: outsider.cookie,
  });
  assert.equal(first.status, 200);
  assert.notEqual(first.cookie, outsider.cookie);
  const reused = await request("/auth/refresh", {
    method: "POST",
    cookie: outsider.cookie,
  });
  assert.equal(reused.status, 401);
  const family = await request("/auth/refresh", {
    method: "POST",
    cookie: first.cookie,
  });
  assert.equal(family.status, 401);
});

// Real image decoding and private media authorization, including soft deletion.
test("image upload is re-encoded and private media obeys message lifecycle", async () => {
  const { readFile } = await import("node:fs/promises");
  const image = await readFile(
    new URL("./fixtures/image.png", import.meta.url),
  );
  const form = new FormData();
  form.append("file", new Blob([image], { type: "image/png" }), "image.png");
  const uploaded = await fetch(base + "/api/v1/media/" + channel, {
    method: "POST",
    headers: { Authorization: "Bearer " + owner.accessToken },
    body: form,
  });
  const file = await uploaded.json();
  assert.equal(uploaded.status, 200, JSON.stringify(file));
  assert.equal(file.contentType, "image/webp");
  const message = await connections[0].invoke("SendMessage", {
    channelId: channel,
    content: "An image",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [file.id],
  });
  const content = await fetch(base + `/api/v1/media/${file.id}/content`, {
    headers: { Authorization: "Bearer " + owner.accessToken },
  });
  assert.equal(content.status, 200);
  assert.match(content.headers.get("content-type"), /image\/webp/);
  const denied = await fetch(base + `/api/v1/media/${file.id}/content`, {
    headers: { Authorization: "Bearer " + outsider.accessToken },
  });
  assert.equal(denied.status, 403);
  await connections[0].invoke("DeleteMessage", message.id);
  const deleted = await fetch(base + `/api/v1/media/${file.id}/content`, {
    headers: { Authorization: "Bearer " + owner.accessToken },
  });
  assert.equal(deleted.status, 404);
});
