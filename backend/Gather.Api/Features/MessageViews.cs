using Gather.Api.Data;
using Gather.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Gather.Api.Features;

public sealed class MessageViews(GatherDb db)
{
    public async Task<object> One(Message message) => (await Many([message]))[0];

    public async Task<object[]> Many(IReadOnlyCollection<Message> messages)
    {
        if (messages.Count == 0) return [];
        var ids = messages.Select(m => m.Id).ToArray();
        var replies = await db.Replies.AsNoTracking().Where(r => ids.Contains(r.MessageId)).ToDictionaryAsync(r => r.MessageId);
        var parentIds = replies.Values.Select(r => r.ParentMessageId).Distinct().ToArray();
        var parents = await db.Messages.AsNoTracking().Where(m => parentIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id);
        var reactions = await db.Reactions.AsNoTracking().Where(r => ids.Contains(r.MessageId)).ToListAsync();
        var pins = (await db.Pins.AsNoTracking().Where(p => ids.Contains(p.MessageId)).Select(p => p.MessageId).ToListAsync()).ToHashSet();
        var userIds = messages.Select(m => m.SenderId).Concat(parents.Values.Select(m => m.SenderId)).Concat(reactions.Select(r => r.UserId)).Distinct().ToArray();
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        return messages.Select(m => {
            Message? parent = null;
            if (replies.TryGetValue(m.Id, out var reply)) parents.TryGetValue(reply.ParentMessageId, out parent);
            return (object)new {
                m.Id, m.ChannelId, m.SenderId, sender = Contracts.Profile(users[m.SenderId]),
                m.Content, m.ClientMessageId, m.CreatedAt, m.EditedAt, m.Deleted,
                attachments = m.Deleted ? [] : m.Attachments.Select(Contracts.File).ToArray(),
                replyTo = m.Deleted || parent == null ? null : new {
                    parent.Id, senderName = users[parent.SenderId].DisplayName,
                    content = parent.Deleted ? "This message was deleted." : parent.Content,
                    parent.Deleted
                },
                pinned = !m.Deleted && pins.Contains(m.Id),
                reactions = m.Deleted ? [] : reactions.Where(r => r.MessageId == m.Id).GroupBy(r => r.Emoji).Select(g => new {
                    emoji = g.Key, count = g.Count(),
                    users = g.Select(r => new { id = r.UserId, displayName = users[r.UserId].DisplayName }).ToArray()
                }).OrderBy(r => r.emoji).ToArray()
            };
        }).ToArray();
    }
}
