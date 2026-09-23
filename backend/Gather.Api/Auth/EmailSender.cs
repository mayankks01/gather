using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Gather.Api.Auth;

public sealed class EmailSender(IConfiguration config, IWebHostEnvironment env, ILogger<EmailSender> logger)
{
    public static void Validate(IConfiguration config, IWebHostEnvironment env)
    {
        if (string.IsNullOrWhiteSpace(config["Email:Host"]))
        {
            if (!env.IsDevelopment()) throw new InvalidOperationException("Configure Email__Host and Email__From for SMTP delivery in Production.");
            return;
        }
        if (!MailboxAddress.TryParse(config["Email:From"], out _)) throw new InvalidOperationException("Configure a valid Email__From address.");
        if (config.GetValue("Email:Port", 587) is < 1 or > 65535) throw new InvalidOperationException("Invalid SMTP port.");
        if (config["Email:Security"] is { } mode && mode is not ("StartTls" or "SslOnConnect")) throw new InvalidOperationException("Email__Security must be StartTls or SslOnConnect.");
        if (config["Email:Username"] is { Length: > 0 } && string.IsNullOrEmpty(config["Email:Password"])) throw new InvalidOperationException("Configure Email__Password for SMTP authentication.");
    }
    public async Task Send(string recipient, string purpose, string url)
    {
        var subject = purpose == "reset" ? "Reset your Gather password" : "Verify your Gather email";
        var body = $"Open this single-use link: {url}\n\nIf you did not request this, ignore this email.\n";
        if (string.IsNullOrWhiteSpace(config["Email:Host"]) && env.IsDevelopment())
        {
            var directory = Path.Combine(env.ContentRootPath, "App_Data", "mail"); Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(Path.Combine(directory, $"{Guid.NewGuid():N}.txt"), $"To: {recipient}\nSubject: {subject}\n\n{body}");
            return;
        }
        try
        {
            var message = new MimeMessage();
            message.From.Add(MailboxAddress.Parse(config["Email:From"]!));
            message.To.Add(MailboxAddress.Parse(recipient)); message.Subject = subject;
            message.Body = new TextPart("plain") { Text = body };
            using var client = new SmtpClient { Timeout = 15000 };
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var security = config["Email:Security"] == "SslOnConnect" ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls;
            await client.ConnectAsync(config["Email:Host"]!, config.GetValue("Email:Port", 587), security, timeout.Token);
            if (config["Email:Username"] is { Length: > 0 } username) await client.AuthenticateAsync(username, config["Email:Password"]!, timeout.Token);
            await client.SendAsync(message, timeout.Token);
            await client.DisconnectAsync(true, timeout.Token);
        }
        catch (Exception error)
        {
            // SMTP exceptions can include recipient/provider details; never log message bodies or tokens.
            logger.LogError("Email delivery failed ({ErrorType}). Check SMTP configuration and provider status.", error.GetType().Name);
            throw new ApiException(503, "Email delivery is temporarily unavailable. Please try again later.");
        }
    }
}
