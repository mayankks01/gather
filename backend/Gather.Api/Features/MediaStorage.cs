using Gather.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gather.Api.Features;

// Local-volume storage is intentionally single-instance. Uploads, claims and cleanup share this lock.
public sealed class MediaStorage(IWebHostEnvironment env, IConfiguration config)
{
    private readonly SemaphoreSlim gate = new(1);
    public string DirectoryPath { get; } = Path.Combine(env.ContentRootPath, "App_Data", "media");
    public long UserLimit { get; } = Positive(config, "Storage:UserQuotaBytes", 512L * 1024 * 1024);
    public long TotalLimit { get; } = Positive(config, "Storage:TotalQuotaBytes", 5L * 1024 * 1024 * 1024);
    public long FreeReserve { get; } = Positive(config, "Storage:MinimumFreeBytes", 256L * 1024 * 1024);
    public TimeSpan Retention { get; } = TimeSpan.FromHours(Positive(config, "Storage:UnattachedHours", 24));
    private static long Positive(IConfiguration c, string name, long fallback)
    {
        var value = c.GetValue(name, fallback);
        if (value <= 0) throw new InvalidOperationException($"{name} must be positive.");
        return value;
    }
    public async Task<IDisposable> Lock(CancellationToken cancel = default)
    {
        await gate.WaitAsync(cancel); return new Lease(gate);
    }
    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private bool disposed;
        public void Dispose() { if (!disposed) { disposed = true; gate.Release(); } }
    }
    // Caller holds the lease. existingFile is the just-written file, already counted on disk.
    public async Task CheckQuota(GatherDb db, string user, long incoming, bool existingFile = false, CancellationToken cancel = default)
    {
        Directory.CreateDirectory(DirectoryPath);
        var used = await db.Attachments.Where(a => a.UploaderId == user).SumAsync(a => (long?)a.Size, cancel) ?? 0;
        Contracts.Require(incoming <= UserLimit - used, "Your upload storage is full. Try again after unused uploads expire.", 413);
        var total = new DirectoryInfo(DirectoryPath).EnumerateFiles().Sum(f => f.Length);
        Contracts.Require((existingFile ? 0 : incoming) <= TotalLimit - total, "Upload storage is full. Please try again later.", 507);
        // On Linux, stat the mounted data directory rather than the container's root filesystem.
        var free = new DriveInfo(OperatingSystem.IsWindows() ? Path.GetPathRoot(Path.GetFullPath(DirectoryPath))! : DirectoryPath).AvailableFreeSpace;
        Contracts.Require(free - (existingFile ? 0 : incoming) >= FreeReserve, "Uploads are temporarily unavailable due to low disk space.", 507);
    }
    public async Task Cleanup(GatherDb db, CancellationToken cancel)
    {
        using var lease = await Lock(cancel);
        Directory.CreateDirectory(DirectoryPath);
        var cutoff = DateTime.UtcNow - Retention;
        foreach (var file in new DirectoryInfo(DirectoryPath).EnumerateFiles())
        {
            cancel.ThrowIfCancellationRequested();
            if (file.LastWriteTimeUtc >= cutoff) continue;
            var row = await db.Attachments.AsNoTracking().SingleOrDefaultAsync(a => a.StorageKey == file.Name, cancel);
            if (row?.MessageId != null) continue;
            // Conditional delete and the shared lease protect a pending attachment being sent.
            if (row != null) await db.Attachments.Where(a => a.Id == row.Id && a.MessageId == null).ExecuteDeleteAsync(cancel);
            file.Delete();
        }
    }
}

public sealed class MediaCleanup(IServiceScopeFactory scopes, MediaStorage storage, ILogger<MediaCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await storage.Cleanup(scope.ServiceProvider.GetRequiredService<GatherDb>(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogError(error, "Media cleanup failed. Check disk access and database availability."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
