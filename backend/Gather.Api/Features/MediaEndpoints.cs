using System.Security.Claims;
using Gather.Api.Data;
using Gather.Api.Domain;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
namespace Gather.Api.Features;

public static class MediaEndpoints
{
    public static void MapMedia(this WebApplication app)
    {
        var media = app.MapGroup("/api/v1/media").RequireAuthorization();
        media.MapPost("/{channelId}", async (string channelId, IFormFile file, ClaimsPrincipal p, GatherDb db, AccessService access, MediaStorage storage, CancellationToken cancel) =>
        {
            var user = p.UserId(); await access.Channel(channelId, user, true);
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            var isImage = new[] { ".jpg", ".jpeg", ".png", ".webp", ".gif" }.Contains(ext);
            Contracts.Require(isImage || new[] { ".mp4", ".webm", ".mov" }.Contains(ext), "Choose a JPEG, PNG, GIF, WebP, MP4, WebM or MOV file.");
            Contracts.Require(file.Length > 0 && file.Length <= (isImage ? 10L : 100L) * 1024 * 1024, isImage ? "Images must be under 10 MB." : "Videos must be under 100 MB.");
            using var lease = await storage.Lock(cancel);
            await storage.CheckQuota(db, user, file.Length, cancel: cancel);
            var directory = storage.DirectoryPath;
            var key = Guid.NewGuid().ToString("N") + (isImage ? ".webp" : ext); var path = Path.Combine(directory, key);
            string contentType;
            await using var source = file.OpenReadStream();
            var saved = false;
            try
            {
                if (isImage)
                {
                    var info = await Image.IdentifyAsync(source, cancel);
                    Contracts.Require((long)info.Width * info.Height * Math.Max(info.FrameMetadataCollection.Count, 1) <= 36_000_000 && info.FrameMetadataCollection.Count <= 100, "This image is too large to process.");
                    var format = info.Metadata.DecodedImageFormat?.Name;
                    var expected = ext switch { ".jpg" or ".jpeg" => "JPEG", ".png" => "PNG", ".gif" => "GIF", _ => "WEBP" };
                    Contracts.Require(string.Equals(format, expected, StringComparison.OrdinalIgnoreCase), "The file content does not match its extension.");
                    source.Position = 0; using var image = await Image.LoadAsync(source, cancel);
                    image.Metadata.ExifProfile = null; image.Metadata.XmpProfile = null; image.Metadata.IccProfile = null; image.Metadata.IptcProfile = null;
                    await image.SaveAsWebpAsync(path, cancel); contentType = "image/webp";
                }
                else
                {
                    var header = new byte[32]; var count = await source.ReadAsync(header, cancel);
                    var webm = count >= 4 && header[0] == 0x1A && header[1] == 0x45 && header[2] == 0xDF && header[3] == 0xA3;
                    var brand = count >= 12 ? System.Text.Encoding.ASCII.GetString(header, 8, 4) : "";
                    var mp4 = count >= 12 && System.Text.Encoding.ASCII.GetString(header, 4, 4) == "ftyp" && new[] { "isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  " }.Contains(brand);
                    Contracts.Require(ext == ".webm" ? webm : mp4, "The video content does not match its extension.");
                    source.Position = 0; await using var output = System.IO.File.Create(path); await source.CopyToAsync(output, cancel);
                    contentType = ext == ".webm" ? "video/webm" : ext == ".mov" ? "video/quicktime" : "video/mp4";
                }
                var size = new FileInfo(path).Length;
                await storage.CheckQuota(db, user, size, existingFile: true, cancel: cancel);
                var attachment = new Attachment { UploaderId = user, ChannelId = channelId, FileName = Path.GetFileName(file.FileName)[..Math.Min(Path.GetFileName(file.FileName).Length, 150)], ContentType = contentType, StorageKey = key, Size = size };
                await storage.Store(db, attachment, path, cancel);
                db.Attachments.Add(attachment); await db.SaveChangesAsync(cancel);
                saved = true;
                return Contracts.File(attachment);
            }
            catch (UnknownImageFormatException) { throw new ApiException(400, "This image could not be decoded."); }
            catch (InvalidImageContentException) { throw new ApiException(400, "This image is damaged or unsupported."); }
            finally { if ((!saved || storage.IsCloud) && System.IO.File.Exists(path)) System.IO.File.Delete(path); }
        }).DisableAntiforgery().RequireRateLimiting("upload");
        media.MapGet("/{id}/content", async (string id, ClaimsPrincipal p, GatherDb db, AccessService access, IWebHostEnvironment env, MediaStorage storage) =>
        {
            var a = await db.Attachments.FindAsync(id) ?? throw new ApiException(404, "Media not found."); await access.Channel(a.ChannelId, p.UserId());
            Contracts.Require(a.MessageId != null || a.UploaderId == p.UserId(), "Media not found.", 404);
            if (a.MessageId != null) Contracts.Require(!await db.Messages.AnyAsync(m => m.Id == a.MessageId && m.Deleted), "Media not found.", 404);
            if (a.StorageKey.StartsWith("cloudinary:")) return storage.CloudContent(a);
            var path = Path.Combine(env.ContentRootPath, "App_Data", "media", a.StorageKey); Contracts.Require(System.IO.File.Exists(path), "Media not found.", 404);
            return Results.File(path, a.ContentType, enableRangeProcessing: true);
        });
    }
}
