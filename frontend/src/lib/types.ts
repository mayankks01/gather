export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  emailVerified?: boolean;
  role?: string;
  online?: boolean;
  mutedUntil?: number;
};
export type PersonSearchResult = User & { connected: boolean };
export type Room = {
  id: string;
  channelId: string;
  name: string;
  description: string;
  isPrivate: boolean;
  color: string;
  ownerId: string;
  role: string;
  memberCount: number;
  unread: number;
};
export type Direct = {
  channelId: string;
  user: User;
  unread: number;
  blocked: boolean;
};
export type DirectRequest = {
  requestId: string;
  channelId: string;
  state: "Pending" | "Accepted" | "Declined" | "Cancelled" | "Removed";
  incoming: boolean;
  createdAt: number;
  user: User;
};
export type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
};
export type Message = {
  id: string;
  channelId: string;
  senderId: string;
  sender: User;
  content: string;
  clientMessageId: string;
  createdAt: number;
  editedAt?: number;
  deleted: boolean;
  attachments: Attachment[];
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
    deleted: boolean;
  } | null;
  pinned?: boolean;
  reactions?: {
    emoji: string;
    count: number;
    users: { id: string; displayName: string }[];
  }[];
  status?: "pending" | "failed";
};
export type History = {
  messages: Message[];
  hasMore: boolean;
  lastRead: string | null;
};
export type Invite = {
  code: string;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
};
