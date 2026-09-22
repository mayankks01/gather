using System.Security.Claims;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Realtime;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace Gather.Api.Features;

public static class PictureEndpoints
{
    public static void MapPictures(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization();
        api.MapGet("/users/{id}/avatar", async (string id, ClaimsPrincipal user, GatherDb db, HttpContext context) =>
        {
            var me = user.UserId();
            if (await db.Blocks.AnyAsync(b => (b.UserId == me && b.TargetId == id) || (b.UserId == id && b.TargetId == me))) return Results.NotFound();
            var picture = await db.UserPictures.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == id);
            context.Response.Headers.CacheControl = "private, no-store";
            return picture == null ? Results.NoContent() : Results.File(picture.Data, "image/webp");
        });
        api.MapPut("/users/me/avatar", async (IFormFile file, ClaimsPrincipal user, GatherDb db, RealtimeEvents events, CancellationToken cancel) =>
        {
            var data = await Prepare(file, cancel); var id = user.UserId();
            // Serializable transaction keeps replacement atomic with concurrent uploads.
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancel);
            var picture = await db.UserPictures.FindAsync(id);
            if (picture == null) db.UserPictures.Add(new UserPicture { UserId = id, Data = data }); else picture.Data = data;
            await db.SaveChangesAsync(cancel); await tx.CommitAsync(cancel);
            await NotifyAvatar(id, db, events); return Results.NoContent();
        }).DisableAntiforgery().RequireRateLimiting("upload");
        api.MapDelete("/users/me/avatar", async (ClaimsPrincipal user, GatherDb db, RealtimeEvents events) =>
        {
            var id = user.UserId(); await db.UserPictures.Where(p => p.UserId == id).ExecuteDeleteAsync();
            await NotifyAvatar(id, db, events); return Results.NoContent();
        });
        api.MapGet("/rooms/{id}/icon", async (string id, ClaimsPrincipal user, GatherDb db, AccessService access, HttpContext context) =>
        {
            var room = await db.Rooms.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id) ?? throw new ApiException(404, "Room not found.");
            if (room.IsPrivate) await access.Role(id, user.UserId(), "Owner", "Admin", "Moderator", "Member");
            var picture = await db.RoomPictures.AsNoTracking().FirstOrDefaultAsync(p => p.RoomId == id);
            context.Response.Headers.CacheControl = "private, no-store";
            return picture == null ? Results.NoContent() : Results.File(picture.Data, "image/webp");
        });
        api.MapPut("/rooms/{id}/icon", async (string id, IFormFile file, ClaimsPrincipal user, GatherDb db, AccessService access, RealtimeEvents events, CancellationToken cancel) =>
        {
            await access.Role(id, user.UserId(), "Owner", "Admin");
            var data = await Prepare(file, cancel);
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancel);
            var picture = await db.RoomPictures.FindAsync(id);
            if (picture == null) db.RoomPictures.Add(new RoomPicture { RoomId = id, Data = data }); else picture.Data = data;
            await db.SaveChangesAsync(cancel); await tx.CommitAsync(cancel);
            await NotifyRoom(id, db, events); return Results.NoContent();
        }).DisableAntiforgery().RequireRateLimiting("upload");
        api.MapDelete("/rooms/{id}/icon", async (string id, ClaimsPrincipal user, GatherDb db, AccessService access, RealtimeEvents events) =>
        {
            await access.Role(id, user.UserId(), "Owner", "Admin");
            await db.RoomPictures.Where(p => p.RoomId == id).ExecuteDeleteAsync();
            await NotifyRoom(id, db, events); return Results.NoContent();
        });
    }
    private static Task NotifyRoom(string id, GatherDb db, RealtimeEvents events) => NotifyRoomCore(id, db, events);
    private static async Task NotifyRoomCore(string id, GatherDb db, RealtimeEvents events)
        => await events.Notify(await db.Members.Where(m => m.RoomId == id).Select(m => m.UserId).ToListAsync(), "PictureChanged", new { path = $"/rooms/{id}/icon" });
    private static async Task NotifyAvatar(string id, GatherDb db, RealtimeEvents events)
    {
        var shared = await db.Members.Where(m => db.Members.Any(own => own.UserId == id && own.RoomId == m.RoomId)).Select(m => m.UserId).Distinct().ToListAsync();
        var direct = await db.Channels.Where(c => c.RoomId == null && (c.UserLow == id || c.UserHigh == id)).Select(c => c.UserLow == id ? c.UserHigh! : c.UserLow!).ToListAsync();
        await events.Notify(shared.Concat(direct).Append(id).Distinct(), "PictureChanged", new { path = $"/users/{id}/avatar" });
    }
    private static async Task<byte[]> Prepare(IFormFile file, CancellationToken cancel)
    {
        Contracts.Require(file.Length is > 0 and <= 5 * 1024 * 1024, "Choose an image up to 5 MB.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var expected = ext switch { ".jpg" or ".jpeg" => "JPEG", ".png" => "PNG", ".webp" => "WEBP", _ => "" };
        Contracts.Require(expected != "", "Choose a JPEG, PNG or WebP image.");
        try
        {
            await using var stream = file.OpenReadStream();
            var options = new DecoderOptions { MaxFrames = 1 };
            var info = await Image.IdentifyAsync(options, stream, cancel);
            Contracts.Require((long)info.Width * info.Height <= 24_000_000, "Choose an image with at most 24 million pixels.");
            Contracts.Require(info.Metadata.DecodedImageFormat?.Name.Equals(expected, StringComparison.OrdinalIgnoreCase) == true, "The file content does not match its extension.");
            stream.Position = 0;
            using var image = await Image.LoadAsync(options, stream, cancel);
            image.Mutate(x => x.AutoOrient().Resize(new ResizeOptions { Size = new Size(256, 256), Mode = ResizeMode.Crop }));
            image.Metadata.ExifProfile = null; image.Metadata.XmpProfile = null; image.Metadata.IccProfile = null; image.Metadata.IptcProfile = null;
            await using var result = new MemoryStream();
            await image.SaveAsync(result, new WebpEncoder { Quality = 82, SkipMetadata = true }, cancel);
            return result.ToArray();
        }
        catch (UnknownImageFormatException) { throw new ApiException(400, "This image could not be decoded."); }
        catch (InvalidImageContentException) { throw new ApiException(400, "This image is damaged or unsupported."); }
    }
}
