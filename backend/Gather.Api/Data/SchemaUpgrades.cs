using Gather.Api.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Gather.Api.Data;

// Additive upgrades also support installations originally created with EnsureCreated.
// Do not drop or rebuild existing tables: users may already have conversations.
public static class SchemaUpgrades
{
    public static async Task Apply(GatherDb db)
    {
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "SchemaVersions" (
                "Version" TEXT NOT NULL PRIMARY KEY, "AppliedAt" BIGINT NOT NULL);
            """);
        const string version = "20260922-chat-tools";
        if (await db.SchemaVersions.AnyAsync(x => x.Version == version)) return;

        if (db.Database.GetDbConnection() is SqliteConnection source && File.Exists(source.DataSource))
        {
            var backups = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(source.DataSource))!, "backups");
            Directory.CreateDirectory(backups);
            await source.OpenAsync();
            await using var backup = new SqliteConnection(new SqliteConnectionStringBuilder {
                DataSource = Path.Combine(backups, $"before-chat-tools-{DateTime.UtcNow:yyyyMMddHHmmssfff}.db")
            }.ToString());
            await backup.OpenAsync();
            source.BackupDatabase(backup);
            await source.CloseAsync();
        }

        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "Replies" (
                "MessageId" TEXT NOT NULL PRIMARY KEY REFERENCES "Messages" ("Id") ON DELETE CASCADE,
                "ParentMessageId" TEXT NOT NULL REFERENCES "Messages" ("Id") ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS "IX_Replies_ParentMessageId" ON "Replies" ("ParentMessageId");
            CREATE TABLE IF NOT EXISTS "Reactions" (
                "MessageId" TEXT NOT NULL REFERENCES "Messages" ("Id") ON DELETE CASCADE,
                "UserId" TEXT NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
                "Emoji" TEXT NOT NULL,
                PRIMARY KEY ("MessageId", "UserId", "Emoji"));
            CREATE TABLE IF NOT EXISTS "Pins" (
                "MessageId" TEXT NOT NULL PRIMARY KEY REFERENCES "Messages" ("Id") ON DELETE CASCADE,
                "PinnedBy" TEXT NOT NULL, "CreatedAt" BIGINT NOT NULL);
            """);
        db.SchemaVersions.Add(new SchemaVersion { Version = version });
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
