using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.HttpOverrides;

namespace Gather.Api;

public static class Hosting
{
    public static void ConfigureHosting(this WebApplicationBuilder builder)
    {
        var publicUrl = builder.Configuration["App:PublicUrl"]!;
        if (!Uri.TryCreate(publicUrl, UriKind.Absolute, out var origin) || origin.AbsolutePath != "/" || origin.Query != "" || origin.Fragment != "" || origin.UserInfo != "" ||
            (!builder.Environment.IsDevelopment() && (origin.Scheme != "https" || origin.IsLoopback)))
            throw new InvalidOperationException("App__PublicUrl must be your frontend's public HTTPS origin in Production.");
        builder.Configuration["App:PublicUrl"] = origin.GetLeftPart(UriPartial.Authority);
        var proxySecret = builder.Configuration["Proxy:VercelSecret"];
        if (proxySecret != null && proxySecret.Length < 32)
            throw new InvalidOperationException("Proxy__VercelSecret must contain at least 32 random characters.");
        builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origin.GetLeftPart(UriPartial.Authority))
            .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .WithHeaders("Authorization", "Content-Type", "X-Gather-Client", "X-SignalR-User-Agent", "X-Requested-With")));
        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.ForwardLimit = 1;
            // Trust only explicitly configured immediate proxies, never all Internet clients.
            o.KnownProxies.Clear(); o.KnownIPNetworks.Clear();
            foreach (var ip in (builder.Configuration["Proxy:KnownProxies"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                o.KnownProxies.Add(IPAddress.Parse(ip));
            foreach (var network in (builder.Configuration["Proxy:KnownNetworks"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
            // Empty lists mean trust-all in this middleware. Use an unreachable documentation address instead.
            if (o.KnownProxies.Count == 0 && o.KnownIPNetworks.Count == 0) o.KnownProxies.Add(IPAddress.Parse("192.0.2.0"));
        });
    }

    public static void UseHosting(this WebApplication app)
    {
        app.UseForwardedHeaders();
        var secret = app.Configuration["Proxy:VercelSecret"];
        var expected = secret == null ? null : SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        app.Use(async (context, next) =>
        {
            // Vercel overwrites x-vercel-forwarded-for. Authenticate the rewrite before trusting it.
            // The backend host must preserve this header; never trust it on direct, unsigned requests.
            var supplied = context.Request.Headers["X-Gather-Proxy-Secret"].ToString();
            var signed = expected != null && supplied.Length <= 512 && CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(supplied)));
            if (signed)
            {
                if (!IPAddress.TryParse(context.Request.Headers["X-Vercel-Forwarded-For"].ToString(), out var ip))
                { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { detail = "Proxy client address is missing." }); return; }
                context.Connection.RemoteIpAddress = ip;
                context.Request.Scheme = "https";
            }
            if (expected != null && context.Request.Path.StartsWithSegments("/api/v1/auth") && !signed)
            { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { detail = "Use the Gather website to sign in." }); return; }
            // CORS does not protect WebSocket handshakes, so check browser origins explicitly too.
            var requestOrigin = context.Request.Headers.Origin.ToString();
            if (requestOrigin.Length > 0 && requestOrigin != app.Configuration["App:PublicUrl"] && !app.Environment.IsDevelopment())
            { context.Response.StatusCode = 403; return; }
            if (context.Request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "private, no-store";
            await next(context);
        });
        app.UseCors();
        if (!app.Environment.IsDevelopment()) app.UseHsts();
    }
}
