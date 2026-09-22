using System.Globalization;
using System.Security.Claims;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Gather.Api.Features;

public static class MessageToolEndpoints
{
    public static void MapMessageTools(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").ValidateInputs().RequireAuthorization();

        api.MapGet("/channels/{channelId}/messages/search", async (
            string channelId, string? q, string? sender, long? from, long? until,
            bool? hasMedia, string? before, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views) =>
        {
            await access.Channel(channelId, user.UserId());
            Contracts.Require(q == null || q.Length <= 200, "Search terms can contain up to 200 characters.");
            Contracts.Require(from == null || until == null || from < until, "Choose a valid date range.");
            var query = db.Messages.AsNoTracking().Include(m => m.Attachments).Where(m => m.ChannelId == channelId && !m.Deleted);
            if (!string.IsNullOrWhiteSpace(q)) { var term = q.Trim().ToLowerInvariant(); query = query.Where(m => m.Content.ToLower().Contains(term)); }
            if (!string.IsNullOrWhiteSpace(sender)) { var name = sender.Trim().TrimStart('@').ToLowerInvariant(); query = query.Where(m => db.Users.Any(u => u.Id == m.SenderId && u.Username == name)); }
            if (from != null) query = query.Where(m => m.CreatedAt >= from);
            if (until != null) query = query.Where(m => m.CreatedAt < until);
            if (hasMedia == true) query = query.Where(m => m.Attachments.Any());
            if (before != null) query = query.Where(m => string.Compare(m.Id, before) < 0);
            var results = await query.OrderByDescending(m => m.Id).Take(31).ToListAsync();
            return new { messages = await views.Many(results.Take(30).ToArray()), hasMore = results.Count > 30 };
        }).RequireRateLimiting("search");

        api.MapGet("/channels/{channelId}/messages/{messageId}/context", async (
            string channelId, string messageId, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views) =>
        {
            await access.Channel(channelId, user.UserId());
            var target = await db.Messages.AsNoTracking().Include(m => m.Attachments).FirstOrDefaultAsync(m => m.Id == messageId && m.ChannelId == channelId)
                ?? throw new ApiException(404, "This message is unavailable.");
            var earlier = await db.Messages.AsNoTracking().Include(m => m.Attachments).Where(m => m.ChannelId == channelId && string.Compare(m.Id, messageId) < 0).OrderByDescending(m => m.Id).Take(25).ToListAsync();
            var later = await db.Messages.AsNoTracking().Include(m => m.Attachments).Where(m => m.ChannelId == channelId && string.Compare(m.Id, messageId) > 0).OrderBy(m => m.Id).Take(25).ToListAsync();
            return new { messages = await views.Many(earlier.Append(target).Concat(later).OrderBy(m => m.Id).ToArray()) };
        });

        api.MapGet("/channels/{channelId}/pins", async (string channelId, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views) =>
        {
            await access.Channel(channelId, user.UserId());
            var messages = await db.Messages.AsNoTracking().Include(m => m.Attachments)
                .Where(m => m.ChannelId == channelId && !m.Deleted && db.Pins.Any(p => p.MessageId == m.Id))
                .OrderByDescending(m => m.Id).Take(100).ToListAsync();
            return await views.Many(messages);
        });

        api.MapPut("/messages/{id}/pin", async (string id, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views, RealtimeEvents events) =>
        {
            var (message, channel) = await GetWritable(id, user.UserId(), db, access);
            if (channel.RoomId != null) await access.Role(channel.RoomId, user.UserId(), "Owner", "Admin", "Moderator");
            if (await db.Pins.FindAsync(id) == null)
            {
                Contracts.Require(await db.Pins.CountAsync(p => db.Messages.Any(m => m.Id == p.MessageId && m.ChannelId == channel.Id)) < 100, "This conversation already has 100 pins. Unpin an older message first.");
                db.Pins.Add(new MessagePin { MessageId = id, PinnedBy = user.UserId() });
                try { await db.SaveChangesAsync(); }
                catch (DbUpdateException) { db.ChangeTracker.Clear(); if (!await db.Pins.AnyAsync(p => p.MessageId == id)) throw; }
            }
            var result = await views.One(message);
            await events.Notify(await access.Audience(channel), "MessageUpdated", result);
            return result;
        });
        api.MapDelete("/messages/{id}/pin", async (string id, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views, RealtimeEvents events) =>
        {
            var (message, channel) = await GetWritable(id, user.UserId(), db, access);
            if (channel.RoomId != null) await access.Role(channel.RoomId, user.UserId(), "Owner", "Admin", "Moderator");
            await db.Pins.Where(p => p.MessageId == id).ExecuteDeleteAsync();
            var result = await views.One(message);
            await events.Notify(await access.Audience(channel), "MessageUpdated", result);
            return result;
        });
        api.MapPut("/messages/{id}/reactions", async (string id, ReactionInput input, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views, RealtimeEvents events) =>
        {
            var (message, channel) = await GetWritable(id, user.UserId(), db, access);
            ValidateEmoji(input.Emoji);
            var me = user.UserId();
            if (await db.Reactions.FindAsync(id, me, input.Emoji) == null)
            {
                Contracts.Require(await db.Reactions.CountAsync(r => r.MessageId == id && r.UserId == me) < 8, "Use up to 8 reactions per message.");
                db.Reactions.Add(new MessageReaction { MessageId = id, UserId = me, Emoji = input.Emoji });
                try { await db.SaveChangesAsync(); }
                catch (DbUpdateException) { db.ChangeTracker.Clear(); if (!await db.Reactions.AnyAsync(r => r.MessageId == id && r.UserId == me && r.Emoji == input.Emoji)) throw; }
            }
            var result = await views.One(message);
            await events.Notify(await access.Audience(channel), "MessageUpdated", result);
            return result;
        });
        api.MapDelete("/messages/{id}/reactions", async (string id, string emoji, ClaimsPrincipal user, GatherDb db, AccessService access, MessageViews views, RealtimeEvents events) =>
        {
            var (message, channel) = await GetWritable(id, user.UserId(), db, access);
            var me = user.UserId();
            await db.Reactions.Where(r => r.MessageId == id && r.UserId == me && r.Emoji == emoji).ExecuteDeleteAsync();
            var result = await views.One(message);
            await events.Notify(await access.Audience(channel), "MessageUpdated", result);
            return result;
        });
    }

    private static async Task<(Message, Channel)> GetWritable(string id, string user, GatherDb db, AccessService access)
    {
        var message = await db.Messages.Include(m => m.Attachments).FirstOrDefaultAsync(m => m.Id == id)
            ?? throw new ApiException(404, "Message not found.");
        var channel = await access.Channel(message.ChannelId, user, true);
        Contracts.Require(!message.Deleted, "This message has been deleted.");
        return (message, channel);
    }
    private static void ValidateEmoji(string emoji)
    {
        Contracts.Require(emoji.Length is > 0 and <= 16 && StringInfo.ParseCombiningCharacters(emoji).Length == 1
            && emoji.EnumerateRunes().Any(r => r.Value >= 0x1F000 || r.Value is >= 0x2300 and <= 0x2BFF), "Choose a single emoji reaction.");
    }
}
