using Gather.Api.Data;
using Gather.Api.Domain;
using Microsoft.EntityFrameworkCore;
namespace Gather.Api.Features;

public sealed class AccessService(GatherDb db)
{
    public async Task<Channel> Channel(string id, string userId, bool posting = false)
    {
        var channel = await db.Channels.FindAsync(id) ?? throw new ApiException(404, "Conversation not found.");
        if (channel.RoomId is { } room)
        {
            var member = await db.Members.FindAsync(room, userId);
            Contracts.Require(member != null && !await db.Bans.AnyAsync(x => x.RoomId == room && x.UserId == userId), "You no longer have access to this room.", 403);
            if (posting) Contracts.Require(member!.MutedUntil <= Clock.Now, "You are temporarily muted in this room.", 403);
        }
        else
        {
            Contracts.Require(channel.UserLow == userId || channel.UserHigh == userId, "Conversation not found.", 403);
            Contracts.Require(await db.DmRequests.AnyAsync(r => r.ChannelId == id && r.State == "Accepted"), "This message request must be accepted before you can chat.", 403);
            Contracts.Require(!await db.Blocks.AnyAsync(b => (b.UserId == channel.UserLow && b.TargetId == channel.UserHigh) || (b.UserId == channel.UserHigh && b.TargetId == channel.UserLow)), "This conversation is unavailable.", 403);
        }
        return channel;
    }
    public async Task<Member> Role(string room, string userId, params string[] allowed)
    {
        var member = await db.Members.FindAsync(room, userId);
        Contracts.Require(member != null && allowed.Contains(member.Role), "You do not have permission for this action.", 403);
        return member!;
    }
    public async Task<List<string>> Audience(Channel channel) => channel.RoomId != null
        ? await db.Members.Where(m => m.RoomId == channel.RoomId).Select(m => m.UserId).ToListAsync()
        : [channel.UserLow!, channel.UserHigh!];
}
