import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { HubConnectionBuilder, LogLevel } = require("@microsoft/signalr");
const base = process.env.GATHER_TEST_URL || "http://localhost:5080";
const nonce = Date.now().toString(36);
let owner, member, outsider, room, channel, sent, invite, dmRequest;
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
test("DM requests are unique per pair and opposite requests do not auto-accept", async () => {
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
  assert.equal(a.result.state, "Pending");
  assert.equal(b.result.state, "Pending");
  assert.equal(a.result.incoming, false);
  assert.equal(b.result.incoming, true);
  dmRequest = a.result;
  const repeated = await request("/dm/" + member.user.username, {
    user: owner,
    method: "POST",
  });
  assert.equal(repeated.result.requestId, dmRequest.requestId);
  assert.equal((await request("/dm", { user: member })).result.length, 0);
  const incoming = (await request("/dm/requests", { user: member })).result;
  assert.equal(
    incoming.filter((r) => r.requestId === dmRequest.requestId).length,
    1,
  );
  assert.equal(incoming[0].incoming, true);
  assert.ok(
    !(await request("/dm/requests", { user: outsider })).result.some(
      (r) => r.requestId === dmRequest.requestId,
    ),
  );
});

test("pending requests deny messages, history, search, pins, uploads and typing", async () => {
  const id = dmRequest.channelId;
  for (const user of [owner, member]) {
    for (const suffix of ["messages", "messages/search", "pins"])
      assert.equal(
        (await request(`/channels/${id}/${suffix}`, { user })).status,
        403,
      );
  }
  for (const hub of [connections[0], connections[1]]) {
    await assert.rejects(() => hub.invoke("SubscribeChannel", id));
    await assert.rejects(() => hub.invoke("StartTyping", id));
    await assert.rejects(() =>
      hub.invoke("SendMessage", {
        channelId: id,
        content: "Not accepted",
        clientMessageId: crypto.randomUUID(),
        attachmentIds: [],
      }),
    );
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob(["placeholder"], { type: "image/png" }),
    "image.png",
  );
  assert.equal(
    (
      await fetch(base + `/api/v1/media/${id}`, {
        method: "POST",
        headers: { Authorization: "Bearer " + owner.accessToken },
        body: form,
      })
    ).status,
    403,
  );
});

test("only the recipient can accept; accepted requests unlock real-time chat", async () => {
  const path = `/dm/requests/${dmRequest.requestId}`;
  assert.equal(
    (await request(path + "/accept", { user: owner, method: "POST" })).status,
    403,
  );
  assert.equal(
    (await request(path + "/accept", { user: outsider, method: "POST" }))
      .status,
    403,
  );
  assert.equal(
    (await request(path + "/cancel", { user: member, method: "POST" })).status,
    403,
  );
  const notification = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Request notification timed out")),
      5000,
    );
    const handler = () => {
      clearTimeout(timeout);
      connections[0].off("DirectRequestsChanged", handler);
      resolve(true);
    };
    connections[0].on("DirectRequestsChanged", handler);
  });
  const accepted = await request(path + "/accept", {
    user: member,
    method: "POST",
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.result));
  await notification;
  assert.equal(
    (await request(path + "/accept", { user: member, method: "POST" })).status,
    200,
  );
  assert.equal(
    (await request(path + "/cancel", { user: owner, method: "POST" })).status,
    409,
  );
  assert.ok(
    (await request("/dm", { user: owner })).result.some(
      (d) => d.channelId === dmRequest.channelId,
    ),
  );
  assert.ok(
    !(await request("/dm/requests", { user: member })).result.some(
      (r) => r.requestId === dmRequest.requestId,
    ),
  );
  const message = await connections[0].invoke("SendMessage", {
    channelId: dmRequest.channelId,
    content: "Accepted hello",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  });
  assert.equal(message.content, "Accepted hello");
  assert.equal(
    (
      await request(`/channels/${dmRequest.channelId}/messages`, {
        user: member,
      })
    ).result.messages[0].id,
    message.id,
  );
});

test("people search separates accepted connections from new people and respects blocking", async () => {
  const search = async (user, term = "") =>
    (await request("/users/search?q=" + encodeURIComponent(term), { user }))
      .result;
  const initial = await search(owner);
  assert.ok(initial.some((u) => u.id === member.user.id && u.connected));
  assert.ok(initial.every((u) => u.connected && u.id !== owner.user.id));
  const byName = await search(member, "OWNER TEST");
  assert.ok(byName.some((u) => u.id === owner.user.id && u.connected));
  assert.ok(
    (await search(owner, outsider.user.username)).some(
      (u) => u.id === outsider.user.id && !u.connected,
    ),
  );
  assert.ok((await search(owner, "m")).every((u) => u.connected));
  await request("/dm/" + dmRequest.channelId, {
    user: owner,
    method: "DELETE",
  });
  assert.ok(
    (await search(owner)).some((u) => u.id === member.user.id && u.connected),
  );
  await request("/dm/" + member.user.username, { user: owner, method: "POST" });
  await request("/blocks/" + member.user.id, { user: owner, method: "POST" });
  assert.ok(
    !(await search(owner, member.user.username)).some(
      (u) => u.id === member.user.id,
    ),
  );
  assert.ok(
    !(await search(member, owner.user.username)).some(
      (u) => u.id === owner.user.id,
    ),
  );
  await request("/blocks/" + member.user.id, { user: owner, method: "DELETE" });
});

test("deleting a DM hides only your copy, supports reopening, and restores on new messages", async () => {
  const id = dmRequest.channelId;
  const inboxHas = async (user) =>
    (await request("/dm", { user })).result.some((d) => d.channelId === id);
  assert.equal(
    (await request("/dm/" + id, { user: outsider, method: "DELETE" })).status,
    404,
  );
  assert.equal(
    (await request("/dm/" + channel, { user: owner, method: "DELETE" })).status,
    404,
  );
  const before = (await request(`/channels/${id}/messages`, { user: member }))
    .result.messages;
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await request("/dm/" + id, { user: owner, method: "DELETE" })).status,
      204,
    );
  assert.equal(await inboxHas(owner), false);
  assert.equal(await inboxHas(member), true);
  assert.deepEqual(
    (await request(`/channels/${id}/messages`, { user: member })).result
      .messages,
    before,
  );
  assert.equal(
    (
      await request("/dm/" + member.user.username, {
        user: owner,
        method: "POST",
      })
    ).result.state,
    "Accepted",
  );
  assert.equal(await inboxHas(owner), true);
  await request("/dm/" + id, { user: owner, method: "DELETE" });
  await connections[1].invoke("SendMessage", {
    channelId: id,
    content: "Restores hidden conversation",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  });
  assert.equal(await inboxHas(owner), true);
  await request("/blocks/" + member.user.id, { user: owner, method: "POST" });
  assert.equal(
    (await request("/dm/" + id, { user: owner, method: "DELETE" })).status,
    204,
  );
  assert.equal(await inboxHas(owner), false);
  await request("/blocks/" + member.user.id, { user: owner, method: "DELETE" });
  assert.equal(await inboxHas(owner), false);
  await request("/dm/" + member.user.username, { user: owner, method: "POST" });
});

test("removing a connection disconnects both users and requires a fresh accepted request", async () => {
  const id = dmRequest.channelId;
  const path = `/dm/${id}/connection`;
  const history = (await request(`/channels/${id}/messages`, { user: owner }))
    .result.messages;
  assert.equal(
    (await request(path, { user: outsider, method: "DELETE" })).status,
    404,
  );
  assert.equal(
    (
      await request(`/dm/${channel}/connection`, {
        user: owner,
        method: "DELETE",
      })
    ).status,
    404,
  );
  const notices = [connections[0], connections[1]].map(
    (hub) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          hub.off("DirectRequestsChanged", handler);
          reject(new Error("Missing disconnect event"));
        }, 5000);
        const handler = () => {
          clearTimeout(timer);
          hub.off("DirectRequestsChanged", handler);
          resolve();
        };
        hub.on("DirectRequestsChanged", handler);
      }),
  );
  assert.equal(
    (await request(path, { user: owner, method: "DELETE" })).status,
    204,
  );
  await Promise.all(notices);
  assert.equal(
    (await request(path, { user: owner, method: "DELETE" })).status,
    204,
  );
  for (const user of [owner, member]) {
    assert.ok(
      !(await request("/dm", { user })).result.some((d) => d.channelId === id),
    );
    assert.equal(
      (await request(`/channels/${id}/messages`, { user })).status,
      403,
    );
    assert.ok(
      !(await request("/users/search?q=", { user })).result.some(
        (u) => u.id === (user === owner ? member.user.id : owner.user.id),
      ),
    );
  }
  for (const hub of [connections[0], connections[1]]) {
    await assert.rejects(() => hub.invoke("SubscribeChannel", id));
    await assert.rejects(() =>
      hub.invoke("SendMessage", {
        channelId: id,
        content: "Not connected",
        clientMessageId: crypto.randomUUID(),
        attachmentIds: [],
      }),
    );
  }
  assert.equal(
    (
      await request(`/dm/requests/${dmRequest.requestId}/accept`, {
        user: member,
        method: "POST",
      })
    ).status,
    409,
  );
  const fresh = (
    await request("/dm/" + owner.user.username, {
      user: member,
      method: "POST",
    })
  ).result;
  assert.equal(fresh.state, "Pending");
  assert.equal(fresh.channelId, id);
  assert.notEqual(fresh.requestId, dmRequest.requestId);
  assert.equal(
    (await request(path, { user: owner, method: "DELETE" })).status,
    409,
  );
  assert.equal(
    (
      await request("/dm/" + member.user.username, {
        user: owner,
        method: "POST",
      })
    ).result.state,
    "Pending",
  );
  assert.equal(
    (
      await request(`/dm/requests/${fresh.requestId}/accept`, {
        user: member,
        method: "POST",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/dm/requests/${fresh.requestId}/accept`, {
        user: owner,
        method: "POST",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await request(`/channels/${id}/messages`, { user: owner })).result
      .messages,
    history,
  );
  dmRequest = fresh;
});

test("decline, cancellation and stale requests cannot bypass recipient approval", async () => {
  const first = (
    await request("/dm/" + outsider.user.username, {
      user: owner,
      method: "POST",
    })
  ).result;
  assert.equal(
    (
      await request(`/dm/requests/${first.requestId}/decline`, {
        user: owner,
        method: "POST",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/dm/requests/${first.requestId}/decline`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/dm/" + outsider.user.username, {
        user: owner,
        method: "POST",
      })
    ).status,
    409,
  );
  const reversed = (
    await request("/dm/" + owner.user.username, {
      user: outsider,
      method: "POST",
    })
  ).result;
  assert.equal(reversed.channelId, first.channelId);
  assert.notEqual(reversed.requestId, first.requestId);
  assert.equal(reversed.state, "Pending");
  assert.equal(
    (
      await request(`/dm/requests/${first.requestId}/accept`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/dm/requests/${reversed.requestId}/cancel`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/dm/requests/${reversed.requestId}/accept`, {
        user: owner,
        method: "POST",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/dm/" + owner.user.username, {
        user: outsider,
        method: "POST",
      })
    ).status,
    409,
  );
});

test("blocking closes pending requests and unblocking does not accept them", async () => {
  const pending = (
    await request("/dm/" + outsider.user.username, {
      user: owner,
      method: "POST",
    })
  ).result;
  assert.equal(pending.state, "Pending");
  await request("/blocks/" + owner.user.id, { user: outsider, method: "POST" });
  assert.equal(
    (
      await request(`/dm/requests/${pending.requestId}/accept`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/dm/" + outsider.user.username, {
        user: owner,
        method: "POST",
      })
    ).status,
    403,
  );
  assert.ok(
    !(await request("/dm/requests", { user: owner })).result.some(
      (r) => r.channelId === pending.channelId,
    ),
  );
  await request("/blocks/" + owner.user.id, {
    user: outsider,
    method: "DELETE",
  });
  assert.equal(
    (
      await request(`/dm/requests/${pending.requestId}/accept`, {
        user: outsider,
        method: "POST",
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(`/channels/${pending.channelId}/messages`, { user: owner }))
      .status,
    403,
  );
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

async function putPicture(
  path,
  user,
  bytes,
  name = "picture.png",
  type = "image/png",
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  return fetch(base + "/api/v1" + path, {
    method: "PUT",
    headers: { Authorization: "Bearer " + user.accessToken },
    body: form,
  });
}
async function picture(path, user) {
  return fetch(base + "/api/v1" + path, {
    headers: user ? { Authorization: "Bearer " + user.accessToken } : {},
  });
}
function webpDimensions(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  for (let offset = 12; offset + 8 < bytes.length;) {
    const type = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4),
      data = offset + 8;
    if (type === "VP8X")
      return [
        bytes.readUIntLE(data + 4, 3) + 1,
        bytes.readUIntLE(data + 7, 3) + 1,
      ];
    if (type === "VP8 ")
      return [
        bytes.readUInt16LE(data + 6) & 0x3fff,
        bytes.readUInt16LE(data + 8) & 0x3fff,
      ];
    if (type === "VP8L") {
      const packed = bytes.readUInt32LE(data + 1);
      return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
    }
    offset = data + length + (length % 2);
  }
  throw new Error("No WebP image dimensions");
}

test("avatars are validated, resized, shared live, replaceable and removable", async () => {
  const { readFile } = await import("node:fs/promises");
  const image = await readFile(
    new URL("./fixtures/image.png", import.meta.url),
  );
  const path = `/users/${owner.user.id}/avatar`;
  assert.equal((await picture(path)).status, 401);
  assert.equal((await picture(path, owner)).status, 204);
  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Picture change timed out")),
      5000,
    );
    const handler = (event) => {
      if (event.path === path) {
        clearTimeout(timeout);
        connections[1].off("PictureChanged", handler);
        resolve(event);
      }
    };
    connections[1].on("PictureChanged", handler);
  });
  const uploaded = await putPicture("/users/me/avatar", owner, image);
  assert.equal(uploaded.status, 204, await uploaded.text());
  assert.equal((await received).path, path);
  const result = await picture(path, member);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /image\/webp/);
  assert.deepEqual(
    webpDimensions(Buffer.from(await result.arrayBuffer())),
    [256, 256],
  );
  assert.equal(
    (await putPicture("/users/me/avatar", owner, image, "second.png")).status,
    204,
  );
  assert.equal(
    (
      await putPicture(
        "/users/me/avatar",
        member,
        image,
        "fake.jpg",
        "image/jpeg",
      )
    ).status,
    400,
  );
  assert.equal(
    (await putPicture("/users/me/avatar", member, "not an image")).status,
    400,
  );
  assert.equal(
    (
      await putPicture(
        "/users/me/avatar",
        member,
        image,
        "picture.svg",
        "image/svg+xml",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await putPicture(
        "/users/me/avatar",
        member,
        new Uint8Array(5 * 1024 * 1024 + 1),
      )
    ).status,
    400,
  );
  assert.equal(
    (await picture(`/users/${member.user.id}/avatar`, member)).status,
    204,
  );
  await request("/blocks/" + owner.user.id, { user: member, method: "POST" });
  assert.equal((await picture(path, member)).status, 404);
  await request("/blocks/" + owner.user.id, { user: member, method: "DELETE" });
  assert.equal(
    (await request("/users/me/avatar", { user: owner, method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await picture(path, owner)).status, 204);
});

test("room icons enforce private access and owner/admin management", async () => {
  const { readFile } = await import("node:fs/promises");
  const image = await readFile(
    new URL("./fixtures/image.png", import.meta.url),
  );
  const path = `/rooms/${room}/icon`;
  assert.equal((await putPicture(path, member, image)).status, 403);
  assert.equal((await putPicture(path, outsider, image)).status, 403);
  assert.equal((await putPicture(path, owner, image)).status, 204);
  assert.equal((await picture(path, outsider)).status, 403);
  const visible = await picture(path, member);
  assert.equal(visible.status, 200);
  assert.deepEqual(
    webpDimensions(Buffer.from(await visible.arrayBuffer())),
    [256, 256],
  );
  assert.equal(
    (await request(path, { user: member, method: "DELETE" })).status,
    403,
  );
  await request(`/rooms/${room}/members/${member.user.id}`, {
    user: owner,
    method: "PATCH",
    body: { role: "Admin" },
  });
  assert.equal((await putPicture(path, member, image)).status, 204);
  assert.equal(
    (await request(path, { user: member, method: "DELETE" })).status,
    204,
  );
  assert.equal((await picture(path, owner)).status, 204);
  await request(`/rooms/${room}/members/${member.user.id}`, {
    user: owner,
    method: "PATCH",
    body: { role: "Member" },
  });
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
