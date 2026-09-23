using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gather.Api;
using Gather.Api.Auth;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

var root = Path.Combine(Path.GetFullPath("artifacts"), "provider-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var env = new TestEnvironment(root);
var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
    ["Email:Provider"] = "Brevo", ["Email:From"] = "Gather <sender@example.test>", ["Email:ApiKey"] = "fake-brevo-key",
    ["Storage:Provider"] = "Cloudinary", ["Cloudinary:CloudName"] = "test-cloud", ["Cloudinary:ApiKey"] = "fake-key", ["Cloudinary:ApiSecret"] = "fake-secret",
    ["Storage:UserQuotaBytes"] = "1024", ["Storage:TotalQuotaBytes"] = "2048", ["Storage:MinimumFreeBytes"] = "1", ["Storage:UnattachedHours"] = "1"
}).Build();
int checks = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
async Task Run(string name, Func<Task> test) { await test(); Console.WriteLine("PASS " + name); checks++; }
async Task Error(Func<Task> action, int status) { try { await action(); throw new Exception("Expected API error"); } catch (ApiException e) { Check(e.Status == status, "Incorrect failure status"); } }
static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = JsonContent.Create(body) };
var handler = new FakeHandler();
var factory = new TestClients(handler);
var email = new EmailSender(config, env, NullLogger<EmailSender>.Instance, factory);
var cloud = new CloudinaryMedia(config, factory, NullLogger<CloudinaryMedia>.Instance);
var storage = new MediaStorage(env, config, cloud);

await Run("Brevo uses HTTPS API key and verified sender, not local mail", async () => {
    EmailSender.Validate(config, env);
    handler.Send = async r => {
        Check(r.RequestUri!.ToString() == "https://api.brevo.com/v3/smtp/email", "Wrong email endpoint");
        Check(r.Headers.GetValues("api-key").Single() == "fake-brevo-key", "Missing API authentication");
        using var body = JsonDocument.Parse(await r.Content!.ReadAsStringAsync());
        Check(body.RootElement.GetProperty("sender").GetProperty("email").GetString() == "sender@example.test", "Incorrect sender");
        Check(body.RootElement.GetProperty("textContent").GetString()!.Contains("token=example"), "Missing action link");
        return Json(new { messageId = "fake" }, HttpStatusCode.Created);
    };
    await email.Send("user@example.test", "verify", "https://gather.example/?token=example");
    Check(!Directory.Exists(Path.Combine(root, "App_Data/mail")), "Cloud email fell back to local outbox");
});
await Run("Brevo failures are actionable and never fall back to lost local mail", async () => {
    handler.Send = _ => Task.FromResult(Json(new { message = "private provider details" }, HttpStatusCode.TooManyRequests));
    await Error(() => email.Send("user@example.test", "reset", "https://gather.example/?token=secret"), 503);
    Check(!Directory.Exists(Path.Combine(root, "App_Data/mail")), "Failure wrote an outbox");
});
await Run("Neon URI decoding, small connection pool and verified TLS", () => {
    config["DATABASE_URL"] = "postgresql://name:p%40ss%3Bword@ep-test-pooler.example:5432/neondb?sslmode=require&channel_binding=require";
    var parsed = new NpgsqlConnectionStringBuilder(DatabaseConfiguration.PostgresConnection(config, false));
    Check(parsed.Password == "p@ss;word" && parsed.SslMode == SslMode.VerifyFull && parsed.MaxPoolSize == 10, "Invalid Neon connection conversion");
    Check(parsed.Host == "ep-test-pooler.example" && parsed.Database == "neondb", "Incorrect Neon host/database");
    config["ConnectionStrings:Gather"] = "Host=localhost;Database=test;SSL Mode=Disable";
    try { DatabaseConfiguration.PostgresConnection(config, false); throw new Exception("Insecure production database allowed"); } catch (InvalidOperationException) { }
    config["ConnectionStrings:Gather"] = null;
    return Task.CompletedTask;
});
var options = new DbContextOptionsBuilder<GatherDb>().UseSqlite("Data Source=" + Path.Combine(root, "test.db")).Options;
await using var db = new GatherDb(options);
await SchemaUpgrades.Apply(db);
var user = new User { Username = "test", Email = "test@example.test" };
var channel = new Channel(); var message = new Message { ChannelId = channel.Id, SenderId = user.Id, ClientMessageId = Guid.NewGuid().ToString() };
db.AddRange(user, channel, message); await db.SaveChangesAsync();
var path = Path.Combine(root, "test.webp"); await File.WriteAllBytesAsync(path, new byte[100]);
var attachment = new Attachment { UploaderId = user.Id, ChannelId = channel.Id, ContentType = "image/webp", Size = 100 };
string? key = null;
await Run("signed authenticated cloud upload is journaled before network, then stored durably", async () => {
    CloudinaryMedia.Validate(config);
    handler.Send = async r => {
        Check(r.RequestUri!.AbsolutePath == "/v1_1/test-cloud/image/upload", "Wrong upload resource");
        var parts = (MultipartFormDataContent)r.Content!;
        var fields = new Dictionary<string, string>();
        foreach (var part in parts) if (part.Headers.ContentDisposition!.Name!.Trim('"') != "file") fields[part.Headers.ContentDisposition.Name.Trim('"')] = await part.ReadAsStringAsync();
        Check(fields["type"] == "authenticated" && fields["overwrite"] == "false", "Public upload or overwrite allowed");
        var signed = $"overwrite=false&public_id={fields["public_id"]}&timestamp={fields["timestamp"]}&type=authenticatedfake-secret";
        Check(fields["signature"] == Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(signed))).ToLowerInvariant(), "Wrong provider signature");
        key = CloudinaryMedia.Key("image", fields["public_id"]);
        await using var fresh = new GatherDb(options);
        Check(await fresh.CloudAssets.AnyAsync(a => a.StorageKey == key), "Upload happened before durable journal");
        return Json(new { public_id = fields["public_id"], type = "authenticated", resource_type = "image", bytes = 100 });
    };
    using var lease = await storage.Lock();
    await storage.CheckQuota(db, user.Id, 100);
    await storage.Store(db, attachment, path, default);
    db.Attachments.Add(attachment); await db.SaveChangesAsync();
    Check(attachment.StorageKey == key && attachment.Size == 100, "Cloud reference not saved");
});
await Run("cloud downloads are streamed through API with expiring signature and byte ranges", async () => {
    handler.Send = r => {
        Check(r.RequestUri!.AbsolutePath.EndsWith("/image/download"), "Wrong download endpoint");
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(r.RequestUri.Query);
        Check(query["type"] == "authenticated" && query["format"] == "webp", "Unprotected download");
        Check(long.Parse(query["expires_at"].ToString()) <= DateTimeOffset.UtcNow.AddMinutes(3).ToUnixTimeSeconds(), "Non-expiring download URL");
        Check(r.Headers.Range!.ToString() == "bytes=0-9", "Range not forwarded");
        var response = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(new byte[10]) };
        response.Content.Headers.ContentRange = new(0, 9, 100); response.Headers.AcceptRanges.Add("bytes"); return Task.FromResult(response);
    };
    var http = new DefaultHttpContext(); http.Response.Body = new MemoryStream(); http.Request.Headers.Range = "bytes=0-9";
    await storage.CloudContent(attachment).ExecuteAsync(http);
    Check(http.Response.StatusCode == 206 && http.Response.Body.Length == 10 && http.Response.Headers.Location.Count == 0, "Download redirected or buffered incorrectly");
    Check(http.Response.Headers.CacheControl == "private, no-store", "Private file is cacheable");
});
await Run("failed cloud upload retains cleanup journal and counts against quota after restart", async () => {
    handler.Send = _ => Task.FromResult(Json(new { error = "outage" }, HttpStatusCode.ServiceUnavailable));
    var pending = new Attachment { UploaderId = user.Id, ChannelId = channel.Id, Size = 500, ContentType = "video/mp4" };
    await Error(() => storage.Store(db, pending, path, default), 503);
    await using var fresh = new GatherDb(options);
    Check(await fresh.CloudAssets.CountAsync() == 2, "Uncertain upload not journaled");
    await Error(() => storage.CheckQuota(fresh, user.Id, 500), 413);
});
await Run("cloud cleanup retries failures and preserves attached messages across restart", async () => {
    attachment.MessageId = message.Id; await db.SaveChangesAsync();
    await db.CloudAssets.ExecuteUpdateAsync(s => s.SetProperty(a => a.CreatedAt, Clock.Now - 7200_000));
    handler.Send = _ => Task.FromResult(Json(new { error = "outage" }, HttpStatusCode.ServiceUnavailable));
    try { await storage.Cleanup(db, default); throw new Exception("Expected deletion failure"); } catch (HttpRequestException) { }
    Check(await db.CloudAssets.CountAsync() == 2, "Failed delete lost cleanup journal");
    handler.Send = async r => {
        var body = await r.Content!.ReadAsStringAsync();
        Check(r.RequestUri!.AbsolutePath.EndsWith("/video/destroy") && body.Contains("type=authenticated"), "Cleanup targeted wrong asset");
        return Json(new { result = "ok" });
    };
    await using var fresh = new GatherDb(options);
    await new MediaStorage(env, config, cloud).Cleanup(fresh, default);
    Check(await fresh.CloudAssets.CountAsync() == 1 && await fresh.Attachments.AnyAsync(a => a.Id == attachment.Id), "Cleanup removed sent attachment");
});
await Run("additive cloud schema upgrade is repeatable and preserves existing messages", async () => {
    await SchemaUpgrades.Apply(db);
    Check(await db.Messages.AnyAsync(m => m.Id == message.Id), "Upgrade removed data");
});
Console.WriteLine($"{checks} provider checks passed. No external services contacted.");

sealed class FakeHandler : HttpMessageHandler
{
    public new Func<HttpRequestMessage, Task<HttpResponseMessage>> Send { get; set; } = _ => throw new Exception("Unexpected provider request");
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Send(request);
}
sealed class TestClients(FakeHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
}
sealed class TestEnvironment(string root) : IWebHostEnvironment
{
    public string EnvironmentName { get; set; } = "Production";
    public string ApplicationName { get; set; } = "Gather.ProviderTests";
    public string WebRootPath { get; set; } = root;
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    public string ContentRootPath { get; set; } = root;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
