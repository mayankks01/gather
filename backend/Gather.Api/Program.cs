using Microsoft.AspNetCore.DataProtection;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Gather.Api;
using Gather.Api.Auth;
using Gather.Api.Data;
using Gather.Api.Features;
using Gather.Api.Realtime;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders(); builder.Logging.AddJsonConsole();
var dataDirectory = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDirectory);
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDirectory, "keys")));
if (string.IsNullOrWhiteSpace(builder.Configuration["Jwt:Key"]))
{
    if (!builder.Environment.IsDevelopment()) throw new InvalidOperationException("Configure Jwt__Key with a random secret of at least 32 characters.");
    builder.Configuration["Jwt:Key"] = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
}
if (builder.Configuration["Jwt:Key"]!.Length < 32) throw new InvalidOperationException("JWT signing key must be at least 32 characters.");
builder.Configuration["App:PublicUrl"] ??= "http://localhost:5173";
builder.Services.AddDbContext<GatherDb>(options =>
{
    if (builder.Configuration["Database:Provider"] == "Postgres") options.UseNpgsql(builder.Configuration.GetConnectionString("Gather"));
    else options.UseSqlite(builder.Configuration.GetConnectionString("Gather") ?? $"Data Source={Path.Combine(dataDirectory, "gather.db")}");
});
builder.Services.AddScoped<AuthService>(); builder.Services.AddScoped<AccessService>(); builder.Services.AddScoped<ChatService>(); builder.Services.AddScoped<RealtimeEvents>(); builder.Services.AddSingleton<ConnectionRegistry>();
builder.Services.AddScoped<MessageViews>();
var signalr = builder.Services.AddSignalR(o => { o.MaximumReceiveMessageSize = 64 * 1024; o.AddFilter<HubErrors>(); });
if (builder.Configuration.GetConnectionString("Redis") is { Length: > 0 } redis) signalr.AddStackExchangeRedis(redis);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.TokenValidationParameters = new TokenValidationParameters { ValidIssuer = "Gather", ValidAudience = "Gather", ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)), ClockSkew = TimeSpan.FromSeconds(5) };
    o.Events = new JwtBearerEvents
    {
        OnMessageReceived = context => { if (context.Request.Path.StartsWithSegments("/hubs/chat")) context.Token = context.Request.Query["access_token"]; return Task.CompletedTask; },
        OnTokenValidated = async context => { var db = context.HttpContext.RequestServices.GetRequiredService<GatherDb>(); var user = await db.Users.FindAsync(context.Principal!.UserId()); if (user == null || user.AuthVersion.ToString() != context.Principal!.FindFirstValue("version")) context.Fail("Session revoked."); }
    };
});
builder.Services.AddAuthorization(); builder.Services.AddProblemDetails();
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 105 * 1024 * 1024);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 106 * 1024 * 1024);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    foreach (var (name, limit, minutes) in new[] { ("auth", 20, 1), ("search", 30, 1), ("upload", 20, 1), ("invite", 30, 60), ("dm", 50, 1440) })
        o.AddPolicy(name, c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = limit, Window = TimeSpan.FromMinutes(minutes), QueueLimit = 0 }));
});
var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff"; context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
    // Refresh cookies are same-site and also require an explicit first-party request header.
    if (context.Request.Path.StartsWithSegments("/api/v1/auth") && context.Request.Method == "POST" && context.Request.Headers["X-Gather-Client"] != "web") { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { detail = "Invalid client request." }); return; }
    try { await next(context); }
    catch (ApiException e) { context.Response.StatusCode = e.Status; await Results.Problem(statusCode: e.Status, detail: e.Message).ExecuteAsync(context); }
});
app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
if (!app.Environment.IsDevelopment()) app.UseHsts();
using (var scope = app.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<GatherDb>(); await SchemaUpgrades.Apply(db); }
app.MapGet("/api/v1/health", () => Results.Ok(new { status = "ok" }));
app.MapAuth(); app.MapRooms(); app.MapConversations(); app.MapMedia();
app.MapMessageTools();
app.MapHub<ChatHub>("/hubs/chat", o => o.CloseOnAuthenticationExpiration = true);
app.Run();
public partial class Program { }


