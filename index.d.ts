// Type definitions for wa-connect-error
// One API over whatsapp-web.js and Baileys.

import { EventEmitter } from 'node:events';

export type EngineName = 'whatsapp-web' | 'baileys' | 'wweb' | 'web' | 'ws' | 'socket' | string;

export type ClientState = 'idle' | 'connecting' | 'open' | 'closed';

export type MediaInput =
  | Buffer
  | Uint8Array
  | string
  | {
      buffer?: Buffer;
      path?: string;
      url?: string;
      data?: string;
      mimetype?: string;
      filename?: string;
    };

export interface Me {
  id?: string;
  phone: string;
  name?: string;
  platform?: string;
  engine: string;
}

export interface NormalizedMessage {
  id: string;
  chatId: string;
  from: string;
  to?: string;
  body: string;
  type: string;
  timestamp: number;
  isGroup: boolean;
  isStatus: boolean;
  fromMe: boolean;
  hasMedia: boolean;
  ack?: number;
  pushName?: string;
  engine: string;
  /** The untouched message object from the engine. */
  raw: any;
}

export interface Chat {
  id: string;
  name?: string;
  isGroup: boolean;
  unreadCount?: number;
  timestamp?: number;
  isMuted?: boolean;
  isArchived?: boolean;
  lastMessage?: string;
  engine: string;
  raw?: any;
}

export interface Contact {
  id: string;
  phone: string;
  name?: string;
  isMyContact?: boolean;
  isBusiness?: boolean;
  engine: string;
  raw?: any;
}

export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface Group {
  id: string;
  name?: string;
  description?: string;
  owner?: string;
  createdAt?: number;
  participants: GroupParticipant[];
  engine: string;
  raw?: any;
}

export interface DownloadedMedia {
  buffer: Buffer;
  mimetype?: string;
  filename?: string;
}

export interface ClientOptions {
  /** Which engine drives WhatsApp. Default 'whatsapp-web'. */
  engine?: EngineName;
  /** Folder that holds the login. Default './.wa-session'. */
  sessionPath?: string;
  /** Render the QR in the terminal. Default true. */
  printQR?: boolean;
  /** Baileys only: reconnect automatically when the socket drops. Default true. */
  autoReconnect?: boolean;
  /** Baileys only: attempts before giving up. Default 5. */
  maxReconnectAttempts?: number;
  /** Baileys only: download full history on login. Default false. */
  syncFullHistory?: boolean;
  /** whatsapp-web.js only: Puppeteer launch options. */
  puppeteer?: Record<string, any>;
  /** whatsapp-web.js only: extra Client options (authStrategy, webVersionCache, ...). */
  clientOptions?: Record<string, any>;
  /** Baileys only: extra makeWASocket options. */
  socketOptions?: Record<string, any>;
  /** Baileys only: a store from makeInMemoryStore, enables history reads. */
  store?: any;
  /** Custom adapter instance, advanced use. */
  adapter?: any;
}

export interface SendOptions {
  caption?: string;
  linkPreview?: boolean;
  sendSeen?: boolean;
  gifPlayback?: boolean;
  voice?: boolean;
  quoted?: NormalizedMessage;
  ephemeralExpiration?: number;
  messageId?: string;
}

export interface PollInput {
  name: string;
  options: string[];
  allowMultipleAnswers?: boolean;
}

export interface LocationInput {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactInput {
  name?: string;
  phone: string | number;
}

export interface RegistrationResult {
  exists: boolean;
  jid: string | null;
}

export interface InviteCode {
  groupId: string;
  code?: string;
}

export declare class WaConnectError extends Error {
  name: 'WaConnectError';
  code: string;
  method?: string;
  engine?: string;
  details?: unknown;
  cause?: unknown;
  static from(err: unknown, meta?: { method?: string; engine?: string; code?: string }): WaConnectError;
  toJSON(): { name: string; code: string; message: string; method?: string; engine?: string };
}

export declare const codes: Readonly<{
  ENGINE_NOT_INSTALLED: 'ENGINE_NOT_INSTALLED';
  ENGINE_UNSUPPORTED: 'ENGINE_UNSUPPORTED';
  INVALID_ARGUMENT: 'INVALID_ARGUMENT';
  NOT_CONNECTED: 'NOT_CONNECTED';
  LOGIN_FAILED: 'LOGIN_FAILED';
  SESSION_ERROR: 'SESSION_ERROR';
  MEDIA_ERROR: 'MEDIA_ERROR';
  SEND_FAILED: 'SEND_FAILED';
  TIMEOUT: 'TIMEOUT';
  WA_ERROR: 'WA_ERROR';
}>;

export declare class WaClient extends EventEmitter {
  constructor(options?: ClientOptions);
  readonly options: ClientOptions;
  readonly engine: string;
  readonly state: ClientState;
  readonly isReady: boolean;
  readonly me: Me | null;
  readonly adapter: any;
  /** The underlying whatsapp-web.js Client or Baileys socket. */
  readonly raw: any;
  readonly qr: string | null;

  connect(): Promise<this>;
  disconnect(options?: { logout?: boolean }): Promise<this>;
  logout(): Promise<this>;
  waitFor(event: string, options?: { timeoutMs?: number }): Promise<any>;
  waitForReady(options?: { timeoutMs?: number }): Promise<Me>;
  requestPairingCode(phoneNumber: string): Promise<{ code: string; phone: string }>;

  sendText(chatId: string, text: string, options?: SendOptions): Promise<NormalizedMessage>;
  sendImage(chatId: string, media: MediaInput, options?: SendOptions): Promise<NormalizedMessage>;
  sendVideo(chatId: string, media: MediaInput, options?: SendOptions): Promise<NormalizedMessage>;
  sendDocument(chatId: string, media: MediaInput, options?: SendOptions): Promise<NormalizedMessage>;
  sendAudio(chatId: string, media: MediaInput, options?: SendOptions): Promise<NormalizedMessage>;
  sendLocation(chatId: string, location: LocationInput): Promise<NormalizedMessage>;
  sendContact(chatId: string, contact: ContactInput): Promise<NormalizedMessage>;
  sendPoll(chatId: string, poll: PollInput): Promise<NormalizedMessage>;
  sendReaction(chatId: string, messageId: string, emoji: string): Promise<{ ok: boolean; messageId: string; emoji: string }>;
  deleteMessage(chatId: string, messageId: string, forEveryone?: boolean): Promise<{ ok: boolean; messageId: string }>;
  forwardMessage(chatId: string, messageId: string): Promise<NormalizedMessage>;
  downloadMedia(messageOrId: string | NormalizedMessage): Promise<DownloadedMedia>;

  getMe(): Promise<Me>;
  getState(): Promise<string | null>;
  getContacts(): Promise<Contact[]>;
  getChats(): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat>;
  getMessages(chatId: string, limit?: number): Promise<NormalizedMessage[]>;
  searchMessages(query: string, limit?: number): Promise<NormalizedMessage[]>;

  getGroups(): Promise<Group[]>;
  getGroupInfo(groupId: string): Promise<Group>;
  createGroup(name: string, participants: Array<string | number>): Promise<Group>;
  addParticipants(groupId: string, participants: Array<string | number>): Promise<any>;
  removeParticipants(groupId: string, participants: Array<string | number>): Promise<any>;
  promoteParticipants(groupId: string, participants: Array<string | number>): Promise<any>;
  demoteParticipants(groupId: string, participants: Array<string | number>): Promise<any>;
  setGroupSubject(groupId: string, subject: string): Promise<{ ok: boolean; groupId: string; subject: string }>;
  setGroupDescription(groupId: string, description: string): Promise<{ ok: boolean; groupId: string; description: string }>;
  leaveGroup(groupId: string): Promise<{ ok: boolean; groupId: string }>;
  getGroupInviteCode(groupId: string): Promise<InviteCode>;
  revokeGroupInvite(groupId: string): Promise<InviteCode>;

  isRegistered(number: string | number): Promise<RegistrationResult>;
  getProfilePicture(id: string | number): Promise<string | null>;
  setStatus(status: string): Promise<{ ok: boolean; status: string }>;
  setDisplayName(name: string): Promise<{ ok: boolean; name: string }>;

  markRead(chatId: string, messageIds?: Array<string | { id: string; fromMe?: boolean }>): Promise<{ ok: boolean; chatId: string; count?: number }>;
  sendTyping(chatId: string, state?: 'composing' | 'paused' | 'recording'): Promise<{ ok: boolean; chatId: string; state: string }>;
  archiveChat(chatId: string, archive?: boolean): Promise<{ ok: boolean; chatId: string; archived: boolean }>;
  pinChat(chatId: string, pin?: boolean): Promise<{ ok: boolean; chatId: string; pinned: boolean }>;
  muteChat(chatId: string, until?: Date | number | null): Promise<{ ok: boolean; chatId: string; mutedUntil: any }>;

  on(event: 'qr', listener: (qr: string) => void): this;
  on(event: 'ready', listener: (me: Me) => void): this;
  on(event: 'message', listener: (message: NormalizedMessage) => void): this;
  on(event: 'message_create', listener: (message: NormalizedMessage) => void): this;
  on(event: 'message_update', listener: (update: any) => void): this;
  on(event: 'message_ack', listener: (ack: { id?: string; ack: number }) => void): this;
  on(event: 'authenticated', listener: (session: any) => void): this;
  on(event: 'state', listener: (state: string) => void): this;
  on(event: 'loading', listener: (info: { percent?: number; message?: string }) => void): this;
  on(event: 'history', listener: (info: { count: number }) => void): this;
  on(event: 'call', listener: (calls: any) => void): this;
  on(event: 'disconnected', listener: (info: { reason?: string; code?: number; loggedOut?: boolean }) => void): this;
  on(event: 'auth_failure', listener: (error: WaConnectError) => void): this;
  on(event: 'closed', listener: (info: { logout: boolean }) => void): this;
  on(event: 'error', listener: (error: WaConnectError) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export declare function createClient(options?: ClientOptions): WaClient;
export declare function availableEngines(): string[];
export declare function createAdapter(options?: ClientOptions): any;
export declare function resolveEngineName(name: string): string;
export declare const VERSION: string;
export declare const DEFAULTS: ClientOptions;
export declare const engines: Record<string, any>;
export declare const adapters: Record<string, any>;
export declare const utils: {
  toDigits(input: unknown): string;
  isGroupId(id: string): boolean;
  toWwebJid(input: string | number): string;
  toBaileysJid(input: string | number): string;
  bareId(id: string): string;
  guessMime(filename?: string): string;
  resolveMedia(input: MediaInput, defaults?: { mimetype?: string; filename?: string }): Promise<DownloadedMedia>;
  buildVcard(contact: ContactInput): string;
  toMillis(timestamp: unknown): number;
};

export default createClient;
