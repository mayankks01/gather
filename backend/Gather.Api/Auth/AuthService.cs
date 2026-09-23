using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Gather.Api.Data;
using Gather.Api.Domain;
using Gather.Api.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
namespace Gather.Api.Auth;

public sealed class AuthService(GatherDb db, IConfiguration config, IWebHostEnvironment env, EmailSender mail, ConnectionRegistry connections)
{
    private static readonly PasswordHasher<User> Hasher = new();
    private static readonly string[] CommonPasswords = ["password123", "password1234", "1234567890", "qwerty12345", "abcdefghij", "letmein1234", "gather12345"];
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public static string Normalize(string value) => value.Trim().ToLowerInvariant();
    public static void ValidatePassword(string password) => Contracts.Require(password.Length is >= 10 and <= 128 && !CommonPasswords.Contains(password.ToLowerInvariant()), "Choose a less common password with 10–128 characters.");
    public static void ValidateUsername(string name) => Contracts.Require(Regex.IsMatch(name, "^[a-z0-9_.]{3,20}$") && !new[] { "admin", "support", "gather", "system", "moderator" }.Contains(name), "Use 3–20 letters, numbers, underscores or dots. This username may be reserved.");
    public async Task<object> Register(RegisterInput input, HttpResponse response)
    {
        var username = Normalize(input.Username); var email = Normalize(input.Email);
        ValidateUsername(username); ValidatePassword(input.Password);
        Contracts.Require(input.AgeConfirmed, "You must be at least 13 to create an account.");
        Contracts.Require(System.Net.Mail.MailAddress.TryCreate(email, out _) && email.Length <= 254, "Enter a valid email address.");
        Contracts.Require(input.DisplayName.Trim().Length is > 0 and <= 60, "Display names must contain 1–60 characters.");
        Contracts.Require(!await db.Users.AnyAsync(u => u.Username == username || u.Email == email), "Unable to register with these details.");
        var user = new User { Username = username, Email = email, DisplayName = input.DisplayName.Trim() };
        user.PasswordHash = Hasher.HashPassword(user, input.Password);
        db.Users.Add(user); await db.SaveChangesAsync();
        await SendActionLink(user, "verify");
        return await Issue(user, response);
    }
    public async Task<object> Login(LoginInput input, HttpResponse response)
    {
        var login = Normalize(input.Login);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == login || u.Email == login);
        // Always perform a password hash check, including for an unknown account.
        var hash = user?.PasswordHash ?? DummyHash;
        var valid = Hasher.VerifyHashedPassword(user ?? new User(), hash, input.Password) != PasswordVerificationResult.Failed;
        if (user == null || user.LockedUntil > Clock.Now || !valid)
        {
            if (user != null && user.LockedUntil <= Clock.Now) { user.FailedLogins++; if (user.FailedLogins >= 5) user.LockedUntil = Clock.Now + 60_000 * Math.Min(user.FailedLogins - 4, 15); await db.SaveChangesAsync(); }
            throw new ApiException(401, "Unable to sign in. Check your details or try again later.");
        }
        user.FailedLogins = 0; user.LockedUntil = 0;
        return await Issue(user, response);
    }
    private static readonly string DummyHash = Hasher.HashPassword(new User(), "dummy-password-value");
    private CookieOptions Cookie => new() { HttpOnly = true, Secure = !env.IsDevelopment(), SameSite = SameSiteMode.Strict, Path = "/api/v1/auth", MaxAge = TimeSpan.FromDays(7) };
    public async Task<object> Issue(User user, HttpResponse response, string? family = null)
    {
        var refresh = Secret();
        db.Sessions.Add(new RefreshSession { UserId = user.Id, Family = family ?? Guid.NewGuid().ToString(), TokenHash = Hash(refresh), ExpiresAt = Clock.Now + (long)TimeSpan.FromDays(7).TotalMilliseconds });
        await db.SaveChangesAsync();
        response.Cookies.Append("gather.refresh", refresh, Cookie);
        var jwt = new JwtSecurityToken("Gather", "Gather", [new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim("version", user.AuthVersion.ToString())], expires: DateTime.UtcNow.AddMinutes(15), signingCredentials: new(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!)), SecurityAlgorithms.HmacSha256));
        return new { accessToken = new JwtSecurityTokenHandler().WriteToken(jwt), user = Contracts.Profile(user) };
    }
    public async Task<object> Refresh(HttpContext context)
    {
        var raw = context.Request.Cookies["gather.refresh"];
        Contracts.Require(raw != null, "Please sign in.", 401);
        await using var tx = await db.Database.BeginTransactionAsync();
        var tokenHash = Hash(raw!);
        var token = await db.Sessions.FirstOrDefaultAsync(t => t.TokenHash == tokenHash);
        Contracts.Require(token != null && token.ExpiresAt > Clock.Now, "Please sign in.", 401);
        if (token!.Revoked)
        {
            await db.Sessions.Where(t => t.Family == token.Family).ExecuteUpdateAsync(s => s.SetProperty(t => t.Revoked, true));
            await tx.CommitAsync(); context.Response.Cookies.Delete("gather.refresh", Cookie);
            throw new ApiException(401, "This session has expired. Please sign in again.");
        }
        // Conditional update ensures only one caller can rotate a token.
        var updated = await db.Sessions.Where(t => t.Id == token.Id && !t.Revoked).ExecuteUpdateAsync(s => s.SetProperty(t => t.Revoked, true));
        Contracts.Require(updated == 1, "Please sign in again.", 401);
        var user = await db.Users.FindAsync(token.UserId) ?? throw new ApiException(401, "Please sign in.");
        var result = await Issue(user, context.Response, token.Family); await tx.CommitAsync(); return result;
    }
    public async Task Logout(HttpContext context)
    {
        var raw = context.Request.Cookies["gather.refresh"];
        if (raw != null) { var hash = Hash(raw); var token = await db.Sessions.FirstOrDefaultAsync(t => t.TokenHash == hash); if (token != null) await db.Sessions.Where(t => t.Family == token.Family).ExecuteUpdateAsync(s => s.SetProperty(t => t.Revoked, true)); }
        context.Response.Cookies.Delete("gather.refresh", Cookie);
    }
    public async Task SendActionLink(User user, string purpose)
    {
        var raw = Secret();
        db.ActionTokens.Add(new ActionToken { Hash = Hash(raw), UserId = user.Id, Purpose = purpose, ExpiresAt = Clock.Now + (long)TimeSpan.FromHours(purpose == "reset" ? 1 : 24).TotalMilliseconds });
        await db.SaveChangesAsync();
        var url = $"{config["App:PublicUrl"]}/?action={purpose}&token={raw}";
        await mail.Send(user.Email, purpose, url);
    }
    public async Task UseAction(string raw, string purpose, string? password = null)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var hash = Hash(raw); var token = await db.ActionTokens.FindAsync(hash);
        Contracts.Require(token != null && token.Purpose == purpose && !token.Used && token.ExpiresAt > Clock.Now, "This link has expired or was already used.");
        var user = await db.Users.FindAsync(token!.UserId) ?? throw new ApiException(400, "Invalid link.");
        if (purpose == "reset") { ValidatePassword(password!); user.PasswordHash = Hasher.HashPassword(user, password!); user.AuthVersion++; user.FailedLogins = 0; user.LockedUntil = 0; await db.Sessions.Where(t => t.UserId == user.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.Revoked, true)); }
        else user.EmailVerified = true;
        var count = await db.ActionTokens.Where(t => t.Hash == hash && !t.Used).ExecuteUpdateAsync(s => s.SetProperty(t => t.Used, true));
        Contracts.Require(count == 1, "This link was already used.");
        await db.SaveChangesAsync(); await tx.CommitAsync();
        if (purpose == "reset") connections.Revoke(user.Id, user.AuthVersion);
    }
}
