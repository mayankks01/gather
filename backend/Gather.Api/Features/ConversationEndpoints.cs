using System.Security.Claims;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Realtime;
using Microsoft.EntityFrameworkCore;
namespace Gather.Api.Features;

public static class ConversationEndpoints
{
    public static void MapConversations(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").ValidateInputs().RequireAuthorization();
        api.MapGet("/channels/{id}/messages", async (string id, string? before, string? after, int? limit, ClaimsPrincipal p, GatherDb db, AccessService access, MessageViews views) =>
        {
            await access.Channel(id, p.UserId()); var query = db.Messages.Include(m => m.Attachments).Where(m => m.ChannelId == id);
            if (before != null) query = query.Where(m => string.Compare(m.Id, before) < 0);
            if (after != null) query = query.Where(m => string.Compare(m.Id, after) > 0);
            var take = Math.Clamp(limit ?? 50, 1, 100); var list = after != null ? await query.OrderBy(m => m.Id).Take(take).ToListAsync() : await query.OrderByDescending(m => m.Id).Take(take).ToListAsync();
            return new { messages = await views.Many(list.OrderBy(m => m.Id).ToArray()), hasMore = list.Count == take, lastRead = (await db.Reads.FindAsync(p.UserId(), id))?.LastMessageId };
        });
        api.MapPost("/channels/{id}/read/{messageId}", async (string id, string messageId, ClaimsPrincipal p, ChatService chat) => { await chat.MarkRead(p.UserId(), id, messageId); return Results.NoContent(); });
        api.MapGet("/dm", async (ClaimsPrincipal p, GatherDb db) => { var id = p.UserId(); return await (from c in db.Channels join u in db.Users on (c.UserLow == id ? c.UserHigh : c.UserLow) equals u.Id where c.RoomId == null && (c.UserLow == id || c.UserHigh == id) && db.DmRequests.Any(r => r.ChannelId == c.Id && r.State == "Accepted") && !db.HiddenDirects.Any(h => h.UserId == id && h.ChannelId == c.Id) orderby c.LastActivity descending select new { channelId = c.Id, user = new { u.Id, u.Username, u.DisplayName, u.Bio }, blocked = db.Blocks.Any(b => (b.UserId == id && b.TargetId == u.Id) || (b.UserId == u.Id && b.TargetId == id)), unread = db.Messages.Count(m => !m.Deleted && m.ChannelId == c.Id && m.SenderId != id && string.Compare(m.Id, db.Reads.Where(s => s.UserId == id && s.ChannelId == c.Id).Select(s => s.LastMessageId).FirstOrDefault() ?? "") > 0) }).ToListAsync(); });
        api.MapGet("/blocks", async (ClaimsPrincipal p, GatherDb db) => { var id = p.UserId(); return await (from b in db.Blocks join u in db.Users on b.TargetId equals u.Id where b.UserId == id select new { u.Id, u.Username, u.DisplayName }).ToListAsync(); });
        api.MapPost("/blocks/{id}", async (string id, ClaimsPrincipal p, GatherDb db, RealtimeEvents events) =>
        {
            var me = p.UserId(); Contracts.Require(id != me && await db.Users.AnyAsync(u => u.Id == id), "Invalid user.");
            await using var transaction = await db.Database.BeginTransactionAsync();
            if (await db.Blocks.FindAsync(me, id) == null) { db.Blocks.Add(new UserBlock { UserId = me, TargetId = id }); await db.SaveChangesAsync(); }
            var now = Clock.Now;
            await db.DmRequests.Where(r => r.State == "Pending" && db.Channels.Any(c => c.Id == r.ChannelId && ((c.UserLow == me && c.UserHigh == id) || (c.UserLow == id && c.UserHigh == me))))
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.State, "Declined").SetProperty(r => r.UpdatedAt, now));
            await transaction.CommitAsync();
            await events.Notify([me, id], "RoomsChanged"); return Results.NoContent();
        });
        api.MapDelete("/blocks/{id}", async (string id, ClaimsPrincipal p, GatherDb db, RealtimeEvents events) => { var me = p.UserId(); await db.Blocks.Where(b => b.UserId == me && b.TargetId == id).ExecuteDeleteAsync(); await events.Notify([me, id], "RoomsChanged"); return Results.NoContent(); });
    }
}
