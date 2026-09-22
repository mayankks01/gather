using System.Security.Claims;
using Gather.Api.Domain;
namespace Gather.Api;

public static class Contracts
{
    public static string UserId(this ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new ApiException(401, "Please sign in.");
    public static object Profile(User u) => new { u.Id, u.Username, u.DisplayName, u.Bio, u.EmailVerified };
    public static object File(Attachment a) => new { a.Id, a.FileName, a.ContentType, a.Size };
    public static object MessageView(Message m, User u) => new { m.Id, m.ChannelId, m.SenderId, sender = Profile(u), m.Content, m.ClientMessageId, m.CreatedAt, m.EditedAt, m.Deleted, attachments = m.Deleted ? [] : m.Attachments.Select(File).ToArray() };
    public static void Require(bool test, string detail, int status = 400) { if (!test) throw new ApiException(status, detail); }
}
public sealed class ApiException(int status, string message) : Exception(message) { public int Status { get; } = status; }
public sealed record RegisterInput(string Email, string Username, string DisplayName, string Password, bool AgeConfirmed);
public sealed record LoginInput(string Login, string Password);
public sealed record ProfileInput(string DisplayName, string Bio, string Username);
public sealed record RoomInput(string Name, string Description, bool IsPrivate, string Color);
public sealed record SendInput(string ChannelId, string Content, string ClientMessageId, string[]? AttachmentIds, string? ReplyToId = null);
public sealed record ReactionInput(string Emoji);
public sealed record RoleInput(string Role);
public sealed record MuteInput(int Minutes);
public sealed record InviteInput(int? Hours, int? MaxUses);
public sealed record BanInput(string Reason);
public sealed record ResetInput(string Token, string Password);
public sealed record EmailInput(string Email);
public sealed record TokenInput(string Token);
