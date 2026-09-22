using Gather.Api.Domain;
using Microsoft.EntityFrameworkCore;
namespace Gather.Api.Data;

public sealed class GatherDb(DbContextOptions<GatherDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshSession> Sessions => Set<RefreshSession>();
    public DbSet<ActionToken> ActionTokens => Set<ActionToken>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Member> Members => Set<Member>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<ReadState> Reads => Set<ReadState>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<Ban> Bans => Set<Ban>();
    public DbSet<UserBlock> Blocks => Set<UserBlock>();
    public DbSet<MessageReply> Replies => Set<MessageReply>();
    public DbSet<MessageReaction> Reactions => Set<MessageReaction>();
    public DbSet<MessagePin> Pins => Set<MessagePin>();
    public DbSet<SchemaVersion> SchemaVersions => Set<SchemaVersion>();
    public DbSet<DmRequest> DmRequests => Set<DmRequest>();
    public DbSet<UserPicture> UserPictures => Set<UserPicture>();
    public DbSet<RoomPicture> RoomPictures => Set<RoomPicture>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(x => x.Username).IsUnique();
        b.Entity<User>().HasIndex(x => x.Email).IsUnique();
        b.Entity<RefreshSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<ActionToken>().HasKey(x => x.Hash);
        b.Entity<Member>().HasKey(x => new { x.RoomId, x.UserId });
        b.Entity<Member>().HasIndex(x => x.UserId);
        b.Entity<Member>().HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Member>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Channel>().HasIndex(x => new { x.UserLow, x.UserHigh }).IsUnique();
        b.Entity<Channel>().HasIndex(x => x.RoomId);
        b.Entity<Channel>().HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Message>().HasIndex(x => new { x.ChannelId, x.Id });
        b.Entity<Message>().HasIndex(x => new { x.SenderId, x.ClientMessageId }).IsUnique();
        b.Entity<Message>().HasOne<Channel>().WithMany().HasForeignKey(x => x.ChannelId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Message>().HasOne<User>().WithMany().HasForeignKey(x => x.SenderId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Attachment>().HasOne<Message>().WithMany(x => x.Attachments).HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ReadState>().HasKey(x => new { x.UserId, x.ChannelId });
        b.Entity<ReadState>().HasOne<Channel>().WithMany().HasForeignKey(x => x.ChannelId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Invite>().HasKey(x => x.Code);
        b.Entity<Invite>().HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Ban>().HasKey(x => new { x.RoomId, x.UserId });
        b.Entity<Ban>().HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<UserBlock>().HasKey(x => new { x.UserId, x.TargetId });
        b.Entity<MessageReply>().HasKey(x => x.MessageId);
        b.Entity<MessageReply>().HasOne<Message>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MessageReply>().HasOne<Message>().WithMany().HasForeignKey(x => x.ParentMessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MessageReply>().HasIndex(x => x.ParentMessageId);
        b.Entity<MessageReaction>().HasKey(x => new { x.MessageId, x.UserId, x.Emoji });
        b.Entity<MessageReaction>().HasOne<Message>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MessageReaction>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MessagePin>().HasKey(x => x.MessageId);
        b.Entity<MessagePin>().HasOne<Message>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SchemaVersion>().HasKey(x => x.Version);
        b.Entity<DmRequest>().HasKey(x => x.ChannelId);
        b.Entity<DmRequest>().HasIndex(x => x.RequestId).IsUnique();
        b.Entity<DmRequest>().HasOne<Channel>().WithMany().HasForeignKey(x => x.ChannelId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<DmRequest>().HasOne<User>().WithMany().HasForeignKey(x => x.RequesterId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<UserPicture>().HasKey(x => x.UserId);
        b.Entity<UserPicture>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<RoomPicture>().HasKey(x => x.RoomId);
        b.Entity<RoomPicture>().HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
    }
}
