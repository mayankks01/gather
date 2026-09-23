using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Gather.Api.Features;

// Original assets are authenticated. Signed download URLs are used only by the API, never returned to browsers.
public sealed class CloudinaryMedia(IConfiguration config, IHttpClientFactory clients, ILogger<CloudinaryMedia> logger)
{
    private readonly IHttpClientFactory Clients = clients;
    public static bool Enabled(IConfiguration config) => config["Storage:Provider"] == "Cloudinary";
    public static void Validate(IConfiguration config)
    {
        if (config["Storage:Provider"] is { } provider && provider is not ("Local" or "Cloudinary")) throw new InvalidOperationException("Storage__Provider must be Local or Cloudinary.");
        if (!Enabled(config)) return;
        if (!Regex.IsMatch(config["Cloudinary:CloudName"] ?? "", "^[a-zA-Z0-9_-]+$") ||
            string.IsNullOrWhiteSpace(config["Cloudinary:ApiKey"]) || string.IsNullOrWhiteSpace(config["Cloudinary:ApiSecret"]))
            throw new InvalidOperationException("Configure Cloudinary__CloudName, Cloudinary__ApiKey and Cloudinary__ApiSecret.");
    }
    private string Endpoint(string resource, string action) => $"https://api.cloudinary.com/v1_1/{config["Cloudinary:CloudName"]}/{resource}/{action}";
    private Dictionary<string, string> Signed(Dictionary<string, string> fields)
    {
        fields["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var text = string.Join("&", fields.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{p.Key}={p.Value}")) + config["Cloudinary:ApiSecret"];
        fields["signature"] = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
        fields["api_key"] = config["Cloudinary:ApiKey"]!;
        return fields;
    }
    public static string Key(string resource, string id) => $"cloudinary:{resource}:{id}";
    private static (string Resource, string Id) Parse(string key)
    {
        var parts = key.Split(':', 3);
        if (parts.Length != 3 || parts[0] != "cloudinary" || parts[1] is not ("image" or "video") || !Regex.IsMatch(parts[2], "^gather/[a-f0-9]{32}$"))
            throw new ApiException(404, "Media not found.");
        return (parts[1], parts[2]);
    }
    public async Task<long> Upload(string key, string path, CancellationToken cancel)
    {
        var (resource, id) = Parse(key);
        using var form = new MultipartFormDataContent();
        foreach (var field in Signed(new() { ["public_id"] = id, ["type"] = "authenticated", ["overwrite"] = "false" })) form.Add(new StringContent(field.Value), field.Key);
        await using var input = File.OpenRead(path);
        form.Add(new StreamContent(input), "file", Path.GetFileName(path));
        try
        {
            using var response = await Clients.CreateClient("media-provider").PostAsync(Endpoint(resource, "upload"), form, cancel);
            response.EnsureSuccessStatusCode();
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancel), cancellationToken: cancel);
            var body = json.RootElement;
            if (body.GetProperty("public_id").GetString() != id || body.GetProperty("type").GetString() != "authenticated" || body.GetProperty("resource_type").GetString() != resource)
                throw new InvalidDataException("Unexpected upload response.");
            var bytes = body.GetProperty("bytes").GetInt64();
            if (bytes <= 0) throw new InvalidDataException("Empty upload response.");
            return bytes;
        }
        catch (Exception error) when (error is not OperationCanceledException || !cancel.IsCancellationRequested)
        {
            logger.LogWarning("Cloud upload failed ({ErrorType}).", error.GetType().Name);
            throw new ApiException(503, "File storage is temporarily unavailable. Please try again.");
        }
    }
    public async Task Delete(string key, CancellationToken cancel)
    {
        var (resource, id) = Parse(key);
        using var response = await Clients.CreateClient("providers").PostAsync(Endpoint(resource, "destroy"),
            new FormUrlEncodedContent(Signed(new() { ["public_id"] = id, ["type"] = "authenticated", ["invalidate"] = "true" })), cancel);
        response.EnsureSuccessStatusCode();
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancel), cancellationToken: cancel);
        if (json.RootElement.GetProperty("result").GetString() is not ("ok" or "not found")) throw new IOException("Cloud deletion failed.");
    }
    public IResult Content(string key, string contentType) => new CloudContent(this, key, contentType);
    private sealed class CloudContent(CloudinaryMedia media, string key, string contentType) : IResult
    {
        public async Task ExecuteAsync(HttpContext context)
        {
            var (resource, id) = Parse(key);
            var format = contentType switch { "image/webp" => "webp", "video/webm" => "webm", "video/quicktime" => "mov", _ => "mp4" };
            var fields = media.Signed(new() { ["public_id"] = id, ["format"] = format, ["type"] = "authenticated", ["expires_at"] = DateTimeOffset.UtcNow.AddMinutes(2).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture) });
            var url = media.Endpoint(resource, "download") + "?" + string.Join("&", fields.Select(p => Uri.EscapeDataString(p.Key) + "=" + Uri.EscapeDataString(p.Value)));
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (context.Request.Headers.Range.Count > 0) request.Headers.TryAddWithoutValidation("Range", context.Request.Headers.Range.ToString());
            HttpResponseMessage response;
            try { response = await media.Clients.CreateClient("media-provider").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted); }
            catch (HttpRequestException) { throw new ApiException(503, "File storage is temporarily unavailable."); }
            catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { throw new ApiException(503, "File storage timed out. Please try again."); }
            using (response)
            {
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) throw new ApiException(404, "Media not found.");
                if (!response.IsSuccessStatusCode && (int)response.StatusCode != 416) throw new ApiException(503, "File storage is temporarily unavailable.");
                context.Response.StatusCode = (int)response.StatusCode;
                context.Response.ContentType = contentType;
                context.Response.Headers.CacheControl = "private, no-store";
                if (response.Content.Headers.ContentLength is long length) context.Response.ContentLength = length;
                if (response.Content.Headers.ContentRange is { } range) context.Response.Headers.ContentRange = range.ToString();
                if (response.Headers.AcceptRanges.Contains("bytes")) context.Response.Headers.AcceptRanges = "bytes";
                await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
        }
    }
}
