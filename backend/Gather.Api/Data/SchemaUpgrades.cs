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
        await ChatTools(db);
        await Pictures(db);
        await DirectRequests(db);
        await HiddenDirects(db);
    }
    private static async Task HiddenDirects(GatherDb db)
    {
        const string version = "20260922-hidden-directs";
        if (await db.SchemaVersions.AnyAsync(x => x.Version == version)) return;
        if (db.Database.GetDbConnection() is SqliteConnection source && File.Exists(source.DataSource))
        {
            var backups = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(source.DataSource))!, "backups");
            Directory.CreateDirectory(backups);
            await source.OpenAsync();
            await using var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(backups, $"before-hidden-directs-{DateTime.UtcNow:yyyyMMddHHmmssfff}.db") }.ToString());
            await backup.OpenAsync(); source.BackupDatabase(backup); await source.CloseAsync();
        }
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "HiddenDirects" (
                "UserId" TEXT NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
                "ChannelId" TEXT NOT NULL REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                PRIMARY KEY ("UserId", "ChannelId"));
            CREATE INDEX IF NOT EXISTS "IX_HiddenDirects_ChannelId" ON "HiddenDirects" ("ChannelId");
            """);
        db.SchemaVersions.Add(new SchemaVersion { Version = version });
        await db.SaveChangesAsync(); await transaction.CommitAsync();
    }
    private static async Task DirectRequests(GatherDb db)
    {
        const string version = "20260922-dm-requests";
        if (await db.SchemaVersions.AnyAsync(x => x.Version == version)) return;
        if (db.Database.GetDbConnection() is SqliteConnection source && File.Exists(source.DataSource))
        {
            var backups = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(source.DataSource))!, "backups");
            Directory.CreateDirectory(backups);
            await source.OpenAsync();
            await using var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(backups, $"before-dm-requests-{DateTime.UtcNow:yyyyMMddHHmmssfff}.db") }.ToString());
            await backup.OpenAsync(); source.BackupDatabase(backup); await source.CloseAsync();
        }
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "DmRequests" (
                "ChannelId" TEXT NOT NULL PRIMARY KEY REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                "RequestId" TEXT NOT NULL,
                "RequesterId" TEXT NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
                "State" TEXT NOT NULL, "CreatedAt" BIGINT NOT NULL, "UpdatedAt" BIGINT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_DmRequests_RequestId" ON "DmRequests" ("RequestId");
            INSERT INTO "DmRequests" ("ChannelId", "RequestId", "RequesterId", "State", "CreatedAt", "UpdatedAt")
                SELECT c."Id", c."Id", c."UserLow", 'Accepted', c."LastActivity", c."LastActivity"
                FROM "Channels" c WHERE c."RoomId" IS NULL
                AND NOT EXISTS (SELECT 1 FROM "DmRequests" d WHERE d."ChannelId" = c."Id");
            """);
        db.SchemaVersions.Add(new SchemaVersion { Version = version });
        await db.SaveChangesAsync(); await transaction.CommitAsync();
    }
    private static async Task Pictures(GatherDb db)
    {
        const string version = "20260922-pictures";
        if (await db.SchemaVersions.AnyAsync(x => x.Version == version)) return;
        if (db.Database.GetDbConnection() is SqliteConnection source && File.Exists(source.DataSource))
        {
            var backups = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(source.DataSource))!, "backups");
            Directory.CreateDirectory(backups);
            await source.OpenAsync();
            await using var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(backups, $"before-pictures-{DateTime.UtcNow:yyyyMMddHHmmssfff}.db") }.ToString());
            await backup.OpenAsync(); source.BackupDatabase(backup); await source.CloseAsync();
        }
        await using var transaction = await db.Database.BeginTransactionAsync();
        var dataType = db.Database.IsSqlite() ? "BLOB" : "BYTEA";
        var sql = "CREATE TABLE IF NOT EXISTS \"UserPictures\" (\"UserId\" TEXT NOT NULL PRIMARY KEY REFERENCES \"Users\" (\"Id\") ON DELETE CASCADE, \"Data\" " + dataType + " NOT NULL); "
            + "CREATE TABLE IF NOT EXISTS \"RoomPictures\" (\"RoomId\" TEXT NOT NULL PRIMARY KEY REFERENCES \"Rooms\" (\"Id\") ON DELETE CASCADE, \"Data\" " + dataType + " NOT NULL);";
        await db.Database.ExecuteSqlRawAsync(sql);
        db.SchemaVersions.Add(new SchemaVersion { Version = version });
        await db.SaveChangesAsync(); await transaction.CommitAsync();
    }
    private static async Task ChatTools(GatherDb db)
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
