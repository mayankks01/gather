using System.Security.Claims;
using Gather.Api.Data;
using Microsoft.EntityFrameworkCore;
namespace Gather.Api.Auth;

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/api/v1/auth").ValidateInputs().RequireRateLimiting("auth");
        auth.MapPost("/register", (RegisterInput input, AuthService service, HttpResponse response) => service.Register(input, response));
        auth.MapPost("/login", (LoginInput input, AuthService service, HttpResponse response) => service.Login(input, response));
        auth.MapPost("/refresh", (AuthService service, HttpContext context) => service.Refresh(context));
        auth.MapPost("/logout", async (AuthService service, HttpContext context) => { await service.Logout(context); return Results.NoContent(); });
        auth.MapPost("/forgot-password", async (EmailInput input, GatherDb db, AuthService service) => { var email = AuthService.Normalize(input.Email); var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email); if (user != null) await service.SendActionLink(user, "reset"); return Results.Ok(new { message = "If that account exists, a recovery link has been sent." }); });
        auth.MapPost("/reset-password", async (ResetInput input, AuthService service) => { await service.UseAction(input.Token, "reset", input.Password); return Results.NoContent(); });
        auth.MapPost("/verify-email", async (TokenInput input, AuthService service) => { await service.UseAction(input.Token, "verify"); return Results.NoContent(); });
        auth.MapPost("/resend-verification", async (ClaimsPrincipal principal, GatherDb db, AuthService service) => { var user = await db.Users.FindAsync(principal.UserId()); if (user != null && !user.EmailVerified) await service.SendActionLink(user, "verify"); return Results.NoContent(); }).RequireAuthorization();
        var users = app.MapGroup("/api/v1/users").ValidateInputs().RequireAuthorization();
        users.MapGet("/me", async (ClaimsPrincipal p, GatherDb db) => Contracts.Profile((await db.Users.FindAsync(p.UserId()))!));
        users.MapPatch("/me", async (ProfileInput input, ClaimsPrincipal p, GatherDb db) =>
        {
            var user = (await db.Users.FindAsync(p.UserId()))!; var name = AuthService.Normalize(input.Username); AuthService.ValidateUsername(name);
            Contracts.Require(input.DisplayName.Trim().Length is > 0 and <= 60 && input.Bio.Length <= 300, "Display names allow 60 characters and bios allow 300.");
            if (name != user.Username) { Contracts.Require(user.UsernameChangedAt == 0 || user.UsernameChangedAt < Domain.Clock.Now - (long)TimeSpan.FromDays(30).TotalMilliseconds, "Usernames can be changed once every 30 days."); Contracts.Require(!await db.Users.AnyAsync(u => u.Username == name), "That username is unavailable."); user.Username = name; user.UsernameChangedAt = Domain.Clock.Now; }
            user.DisplayName = input.DisplayName.Trim(); user.Bio = input.Bio.Trim(); await db.SaveChangesAsync(); return Contracts.Profile(user);
        });
        users.MapGet("/search", async (string q, ClaimsPrincipal p, GatherDb db) => { Contracts.Require(q.Length is >= 3 and <= 20, "Enter at least 3 characters."); var prefix = AuthService.Normalize(q); var id = p.UserId(); return (await db.Users.Where(u => u.Id != id && u.Username.StartsWith(prefix) && !db.Blocks.Any(b => (b.UserId == id && b.TargetId == u.Id) || (b.UserId == u.Id && b.TargetId == id))).Take(10).ToListAsync()).Select(Contracts.Profile); }).RequireRateLimiting("search");
    }
}
