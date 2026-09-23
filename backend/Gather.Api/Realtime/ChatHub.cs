using System.Collections.Concurrent;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Features;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
namespace Gather.Api.Realtime;

public sealed class ConnectionRegistry
{
    private readonly ConcurrentDictionary<string, (string User, int Version, Action Abort)> connections = new();
    public void Add(string connection, string user, int version, Action abort) => connections[connection] = (user, version, abort);
    public void Remove(string connection) => connections.TryRemove(connection, out _);
    public bool Online(string user) => connections.Values.Any(c => c.User == user);
    public void Revoke(string user, int version)
    {
        foreach (var entry in connections.Values.Where(c => c.User == user && c.Version < version)) entry.Abort();
    }
    public static string Group(string user, int version) => $"user:{user}:v:{version}";
}
public sealed class RealtimeEvents(IHubContext<ChatHub> hub, GatherDb db)
{
    public async Task Notify(IEnumerable<string> users, string name, object? payload = null)
    {
        var ids = users.Distinct().ToArray();
        // Versioned groups also exclude revoked passive connections on other Redis-connected instances.
        var current = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.AuthVersion }).ToListAsync();
        await hub.Clients.Groups(current.Select(u => ConnectionRegistry.Group(u.Id, u.AuthVersion))).SendAsync(name, payload);
    }
    public async Task RoomChanged(string room) => await Notify(await db.Members.Where(m => m.RoomId == room).Select(m => m.UserId).ToListAsync(), "RoomsChanged");
}
public sealed class ChatService(GatherDb db, AccessService access, RealtimeEvents events, MessageViews views, MediaStorage storage)
{
    public async Task<object> Send(string userId, SendInput input)
    {
        var channel = await access.Channel(input.ChannelId, userId, true);
        var files = input.AttachmentIds ?? [];
        using var mediaLease = files.Length > 0 ? await storage.Lock() : null;
        Contracts.Require(input.Content.Length <= 4000 && (input.Content.Trim().Length > 0 || files.Length > 0), "Write a message of up to 4,000 characters, or attach a file.");
        Contracts.Require(Guid.TryParse(input.ClientMessageId, out _) && files.Length <= 10 && files.Distinct().Count() == files.Length, "Invalid message or attachments.");
        var existing = await db.Messages.Include(m => m.Attachments).FirstOrDefaultAsync(m => m.SenderId == userId && m.ClientMessageId == input.ClientMessageId);
        if (existing != null) { Contracts.Require(existing.ChannelId == input.ChannelId, "This message ID is already used."); return await views.One(existing); }
        var since = Clock.Now - 5000;
        Contracts.Require(await db.Messages.CountAsync(m => m.SenderId == userId && m.CreatedAt >= since) < 10, "You are sending too quickly. Wait a moment.", 429);
        var attachments = await db.Attachments.Where(a => files.Contains(a.Id) && a.UploaderId == userId && a.ChannelId == channel.Id && a.MessageId == null).ToListAsync();
        Contracts.Require(attachments.Count == files.Length, "An attachment is unavailable.");
        if (input.ReplyToId != null)
            Contracts.Require(await db.Messages.AnyAsync(m => m.Id == input.ReplyToId && m.ChannelId == channel.Id && !m.Deleted), "The message you are replying to is unavailable.");
        var message = new Message { ChannelId = channel.Id, SenderId = userId, Content = input.Content.Trim(), ClientMessageId = input.ClientMessageId, Attachments = attachments };
        channel.LastActivity = message.CreatedAt; db.Messages.Add(message);
        if (channel.RoomId == null)
            db.HiddenDirects.RemoveRange(await db.HiddenDirects.Where(h => h.ChannelId == channel.Id).ToListAsync());
        if (input.ReplyToId != null) db.Replies.Add(new MessageReply { MessageId = message.Id, ParentMessageId = input.ReplyToId });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); var duplicate = await db.Messages.Include(m => m.Attachments).FirstOrDefaultAsync(m => m.SenderId == userId && m.ClientMessageId == input.ClientMessageId); if (duplicate == null || duplicate.ChannelId != channel.Id) throw; return await views.One(duplicate); }
        var view = await views.One(message);
        await events.Notify(await access.Audience(channel), "MessageCreated", view);
        return view;
    }
    public async Task Mutate(string userId, string id, string? content)
    {
        var message = await db.Messages.Include(m => m.Attachments).FirstOrDefaultAsync(m => m.Id == id) ?? throw new ApiException(404, "Message not found.");
        var channel = await access.Channel(message.ChannelId, userId, true);
        Contracts.Require(!message.Deleted, "This message has been deleted.");
        if (message.SenderId != userId) { Contracts.Require(content == null && channel.RoomId != null, "You cannot edit this message.", 403); await access.Role(channel.RoomId!, userId, "Owner", "Admin", "Moderator"); }
        if (content != null) { Contracts.Require(content.Trim().Length is > 0 and <= 4000, "Use 1–4,000 characters."); message.Content = content.Trim(); message.EditedAt = Clock.Now; }
        else { message.Deleted = true; message.Content = ""; }
        await using var transaction = await db.Database.BeginTransactionAsync();
        if (message.Deleted)
        {
            await db.Pins.Where(p => p.MessageId == id).ExecuteDeleteAsync();
            await db.Reactions.Where(r => r.MessageId == id).ExecuteDeleteAsync();
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        var audience = await access.Audience(channel);
        await events.Notify(audience, "MessageUpdated", await views.One(message));
        // Clients update quoted previews without loading an unbounded set of replies.
        await events.Notify(audience, "ReplySourceUpdated", new { channelId = channel.Id, id = message.Id, message.Content, message.Deleted });
    }
    public async Task MarkRead(string userId, string channelId, string messageId)
    {
        await access.Channel(channelId, userId);
        Contracts.Require(await db.Messages.AnyAsync(m => m.Id == messageId && m.ChannelId == channelId), "Invalid read marker.");
        var read = await db.Reads.FindAsync(userId, channelId);
        if (read == null) db.Reads.Add(new ReadState { UserId = userId, ChannelId = channelId, LastMessageId = messageId });
        else if (string.CompareOrdinal(messageId, read.LastMessageId) > 0) read.LastMessageId = messageId;
        await db.SaveChangesAsync(); await events.Notify([userId], "UnreadUpdated", new { channelId });
    }
}
[Authorize]
public sealed class ChatHub(ChatService chat, AccessService access, ConnectionRegistry registry, RealtimeEvents events, GatherDb db) : Hub
{
    private string Me => Context.User!.UserId();
    public override async Task OnConnectedAsync()
    {
        if (!int.TryParse(Context.User!.FindFirst("version")?.Value, out var version)) { Context.Abort(); return; }
        registry.Add(Context.ConnectionId, Me, version, Context.Abort);
        var current = await db.Users.AsNoTracking().Where(u => u.Id == Me).Select(u => (int?)u.AuthVersion).SingleOrDefaultAsync();
        if (current != version) { registry.Remove(Context.ConnectionId); Context.Abort(); return; }
        await Groups.AddToGroupAsync(Context.ConnectionId, ConnectionRegistry.Group(Me, version));
        await base.OnConnectedAsync();
    }
    public override async Task OnDisconnectedAsync(Exception? exception) { registry.Remove(Context.ConnectionId); await base.OnDisconnectedAsync(exception); }
    public async Task SubscribeChannel(string channelId) { await access.Channel(channelId, Me); }
    public Task UnsubscribeChannel(string channelId) => Task.CompletedTask;
    public Task<object> SendMessage(SendInput input) => chat.Send(Me, input);
    public Task EditMessage(string id, string content) => chat.Mutate(Me, id, content);
    public Task DeleteMessage(string id) => chat.Mutate(Me, id, null);
    public Task MarkRead(string channelId, string messageId) => chat.MarkRead(Me, channelId, messageId);
    public async Task StartTyping(string channelId)
    {
        var key = "typing:" + channelId;
        if (Context.Items.TryGetValue(key, out var value) && value is long last && Clock.Now - last < 1500) return;
        Context.Items[key] = Clock.Now;
        var channel = await access.Channel(channelId, Me, true);
        var blocked = await db.Blocks.Where(b => b.UserId == Me || b.TargetId == Me).Select(b => b.UserId == Me ? b.TargetId : b.UserId).ToListAsync();
        await events.Notify((await access.Audience(channel)).Where(u => u != Me && !blocked.Contains(u)), "TypingChanged", new { channelId, userId = Me });
    }
}
public sealed class HubErrors : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            var db = context.ServiceProvider.GetRequiredService<GatherDb>();
            var user = await db.Users.FindAsync(context.Context.User!.UserId());
            if (user == null || user.AuthVersion.ToString() != context.Context.User!.FindFirst("version")?.Value)
            {
                context.Context.Abort();
                throw new ApiException(401, "Session revoked. Please sign in again.");
            }
            foreach (var argument in context.HubMethodArguments) InputValidation.Check(argument);
            return await next(context);
        }
        catch (ApiException e) { throw new HubException(e.Message); }
    }
}

