using System.Security.Claims;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Gather.Api.Features;

public static class DirectRequestEndpoints
{
    public static void MapDirectRequests(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/dm").RequireAuthorization();
        api.MapGet("/requests", async (ClaimsPrincipal user, GatherDb db) =>
        {
            var me = user.UserId();
            return await (from r in db.DmRequests
                join c in db.Channels on r.ChannelId equals c.Id
                join u in db.Users on (c.UserLow == me ? c.UserHigh : c.UserLow) equals u.Id
                where (c.UserLow == me || c.UserHigh == me) && r.State == "Pending"
                    && !db.Blocks.Any(b => (b.UserId == me && b.TargetId == u.Id) || (b.UserId == u.Id && b.TargetId == me))
                orderby r.CreatedAt descending
                select new { r.RequestId, r.ChannelId, r.State, r.CreatedAt, incoming = r.RequesterId != me, user = new { u.Id, u.Username, u.DisplayName, u.Bio } }).ToListAsync();
        });
        api.MapPost("/{username}", Start).RequireRateLimiting("dm");
        api.MapPost("/requests/{requestId}/{action}", Decide);
    }

    private static async Task<object> Start(string username, ClaimsPrincipal principal, GatherDb db, RealtimeEvents events)
    {
        var me = principal.UserId(); var normalized = username.Trim().ToLowerInvariant();
        var other = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == normalized);
        Contracts.Require(other != null && other.Id != me, "Choose another user.");
        await CheckBlock(me, other!.Id, db);
        var ids = new[] { me, other.Id }.Order(StringComparer.Ordinal).ToArray();
        var channel = await db.Channels.AsNoTracking().FirstOrDefaultAsync(c => c.UserLow == ids[0] && c.UserHigh == ids[1]);
        var changed = false;
        DmRequest? request;
        if (channel == null)
        {
            channel = new Channel { UserLow = ids[0], UserHigh = ids[1], Name = "direct" };
            request = new DmRequest { ChannelId = channel.Id, RequesterId = me };
            db.Channels.Add(channel); db.DmRequests.Add(request);
            try { await db.SaveChangesAsync(); changed = true; }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                channel = await db.Channels.AsNoTracking().FirstOrDefaultAsync(c => c.UserLow == ids[0] && c.UserHigh == ids[1]);
                if (channel == null) throw;
            }
        }
        request = await db.DmRequests.AsNoTracking().SingleAsync(r => r.ChannelId == channel.Id);
        if (request.State is "Declined" or "Cancelled")
        {
            // Closed requests cannot be immediately resent to someone who declined.
            var wait = request.State == "Declined" ? 7 * 86400000L : 60000L;
            Contracts.Require(request.RequesterId != me || Clock.Now - request.UpdatedAt >= wait,
                request.State == "Declined" ? "This request was closed. You can request again after 7 days." : "Wait a minute before sending another request.", 409);
            var nextId = Guid.NewGuid().ToString(); var now = Clock.Now;
            var updated = await db.DmRequests.Where(r => r.ChannelId == channel.Id && r.RequestId == request.RequestId && r.State == request.State)
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.RequestId, nextId).SetProperty(r => r.RequesterId, me)
                    .SetProperty(r => r.State, "Pending").SetProperty(r => r.CreatedAt, now).SetProperty(r => r.UpdatedAt, now));
            changed = updated > 0;
            request = await db.DmRequests.AsNoTracking().SingleAsync(r => r.ChannelId == channel.Id);
        }
        if (changed) await events.Notify(ids, "DirectRequestsChanged");
        return new { channelId = channel.Id, request.RequestId, request.State, incoming = request.RequesterId != me, user = Contracts.Profile(other) };
    }

    private static async Task<object> Decide(string requestId, string action, ClaimsPrincipal principal, GatherDb db, RealtimeEvents events)
    {
        var me = principal.UserId();
        var request = await db.DmRequests.AsNoTracking().FirstOrDefaultAsync(r => r.RequestId == requestId) ?? throw new ApiException(404, "Request not found.");
        var channel = await db.Channels.AsNoTracking().SingleAsync(c => c.Id == request.ChannelId);
        Contracts.Require(channel.UserLow == me || channel.UserHigh == me, "Request not found.", 403);
        var state = action switch { "accept" => "Accepted", "decline" => "Declined", "cancel" => "Cancelled", _ => throw new ApiException(400, "Invalid request action.") };
        Contracts.Require(action == "cancel" ? request.RequesterId == me : request.RequesterId != me,
            action == "cancel" ? "Only the sender can cancel this request." : "Only the recipient can respond to this request.", 403);
        await CheckBlock(channel.UserLow!, channel.UserHigh!, db);
        if (request.State != state)
        {
            var now = Clock.Now;
            var changed = await db.DmRequests.Where(r => r.RequestId == requestId && r.State == "Pending")
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.State, state).SetProperty(r => r.UpdatedAt, now));
            Contracts.Require(changed == 1, "This request has already been handled. Refresh your requests.", 409);
        }
        await events.Notify([channel.UserLow!, channel.UserHigh!], "DirectRequestsChanged");
        return new { channelId = channel.Id, state };
    }
    private static async Task CheckBlock(string first, string second, GatherDb db)
        => Contracts.Require(!await db.Blocks.AnyAsync(b => (b.UserId == first && b.TargetId == second) || (b.UserId == second && b.TargetId == first)), "This conversation is unavailable.", 403);
}
