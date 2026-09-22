namespace Gather.Api.Domain;

public sealed class User
{
    public string Id { get; set; } = Guid.CreateVersion7().ToString();
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Bio { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool EmailVerified { get; set; }
    public int FailedLogins { get; set; }
    public long LockedUntil { get; set; }
    public long UsernameChangedAt { get; set; }
    public int AuthVersion { get; set; }
    public long CreatedAt { get; set; } = Clock.Now;
}
public sealed class RefreshSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string Family { get; set; } = Guid.NewGuid().ToString();
    public long ExpiresAt { get; set; }
    public bool Revoked { get; set; }
}
public sealed class ActionToken
{
    public string Hash { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Purpose { get; set; } = "";
    public long ExpiresAt { get; set; }
    public bool Used { get; set; }
}
public sealed class Room
{
    public string Id { get; set; } = Guid.CreateVersion7().ToString();
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Color { get; set; } = "#6554c0";
    public bool IsPrivate { get; set; }
    public string OwnerId { get; set; } = "";
    public long CreatedAt { get; set; } = Clock.Now;
}
public sealed class Member
{
    public string RoomId { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Role { get; set; } = "Member";
    public long MutedUntil { get; set; }
}
public sealed class Channel
{
    public string Id { get; set; } = Guid.CreateVersion7().ToString();
    public string? RoomId { get; set; }
    public string Name { get; set; } = "general";
    public string? UserLow { get; set; }
    public string? UserHigh { get; set; }
    public long LastActivity { get; set; } = Clock.Now;
}
public sealed class Message
{
    public string Id { get; set; } = Guid.CreateVersion7().ToString();
    public string ChannelId { get; set; } = "";
    public string SenderId { get; set; } = "";
    public string Content { get; set; } = "";
    public string ClientMessageId { get; set; } = "";
    public long CreatedAt { get; set; } = Clock.Now;
    public long? EditedAt { get; set; }
    public bool Deleted { get; set; }
    public List<Attachment> Attachments { get; set; } = [];
}
public sealed class Attachment
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UploaderId { get; set; } = "";
    public string ChannelId { get; set; } = "";
    public string? MessageId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public long Size { get; set; }
}
public sealed class ReadState
{
    public string UserId { get; set; } = "";
    public string ChannelId { get; set; } = "";
    public string LastMessageId { get; set; } = "";
}
public sealed class Invite
{
    public string Code { get; set; } = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
    public string RoomId { get; set; } = "";
    public long? ExpiresAt { get; set; }
    public int? MaxUses { get; set; }
    public int Uses { get; set; }
    public bool Revoked { get; set; }
}
public sealed class Ban { public string RoomId { get; set; } = ""; public string UserId { get; set; } = ""; public string Reason { get; set; } = ""; }
public sealed class UserBlock { public string UserId { get; set; } = ""; public string TargetId { get; set; } = ""; }
public static class Clock { public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }

public sealed class MessageReply
{
    public string MessageId { get; set; } = "";
    public string ParentMessageId { get; set; } = "";
}
public sealed class MessageReaction
{
    public string MessageId { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Emoji { get; set; } = "";
}
public sealed class MessagePin
{
    public string MessageId { get; set; } = "";
    public string PinnedBy { get; set; } = "";
    public long CreatedAt { get; set; } = Clock.Now;
}
public sealed class SchemaVersion
{
    public string Version { get; set; } = "";
    public long AppliedAt { get; set; } = Clock.Now;
}
public sealed class UserPicture { public string UserId { get; set; } = ""; public byte[] Data { get; set; } = []; }
public sealed class RoomPicture { public string RoomId { get; set; } = ""; public byte[] Data { get; set; } = []; }
