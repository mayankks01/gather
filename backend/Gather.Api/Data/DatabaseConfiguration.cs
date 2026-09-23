using Npgsql;

namespace Gather.Api.Data;

public static class DatabaseConfiguration
{
    public static string PostgresConnection(IConfiguration config, bool development)
    {
        var raw = config.GetConnectionString("Gather") ?? config["DATABASE_URL"];
        if (string.IsNullOrWhiteSpace(raw)) throw new InvalidOperationException("Set ConnectionStrings__Gather or DATABASE_URL for PostgreSQL.");
        NpgsqlConnectionStringBuilder connection;
        if (raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            var uri = new Uri(raw);
            var credentials = uri.UserInfo.Split(':', 2);
            if (credentials.Length != 2 || uri.AbsolutePath.Length < 2) throw new InvalidOperationException("DATABASE_URL must include username, password and database.");
            connection = new NpgsqlConnectionStringBuilder { Host = uri.Host, Port = uri.IsDefaultPort ? 5432 : uri.Port,
                Username = Uri.UnescapeDataString(credentials[0]), Password = Uri.UnescapeDataString(credentials[1]),
                Database = Uri.UnescapeDataString(uri.AbsolutePath[1..]), SslMode = SslMode.VerifyFull,
                MaxPoolSize = 10, Timeout = 30, CommandTimeout = 30 };
            // Neon supplies sslmode/channel_binding URI options. Require verified TLS regardless of weaker URI hints.
        }
        else connection = new NpgsqlConnectionStringBuilder(raw);
        if (!development && connection.SslMode != SslMode.VerifyFull) throw new InvalidOperationException("Production PostgreSQL requires SSL Mode=VerifyFull.");
        return connection.ConnectionString;
    }
}
