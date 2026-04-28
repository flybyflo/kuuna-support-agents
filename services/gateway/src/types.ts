export type GatewayEventType = "message_created" | "message_edited" | "message_deleted";

export type GatewayInboundMedia = {
  provider_media_id: string;
  mime_type: string;
  file_name?: string | null;
  byte_size?: number | null;
  download_url?: string | null;
  inline_data_base64?: string | null;
};

export type GatewayInboundEvent = {
  trace_id: string;
  provider: "whatsapp-neonize";
  provider_group_id: string;
  provider_message_id: string;
  sender_provider_user_id?: string | null;
  event_type: GatewayEventType;
  occurred_at: string;
  message: {
    text?: string | null;
    reply_to_provider_message_id?: string | null;
    mentions: string[];
    media: GatewayInboundMedia[];
  };
  raw_event?: Record<string, unknown> | null;
};

export type GatewayGroup = {
  jid: string;
  name: string;
  participants_count: number;
};

export type ConnectionSnapshot = {
  connected: boolean;
  last_event: string;
  last_changed_at: string;
  checked_at: string;
  last_error?: string | null;
};

export type QrSnapshot = {
  qr: string | null;
  updated_at: string;
};

export type GatewayClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  listGroups(): Promise<GatewayGroup[]>;
  createGroup(name: string, participants: string[]): Promise<GatewayGroup>;
  sendText(input: {
    providerGroupId: string;
    text: string;
    replyToProviderMessageId?: string | null;
  }): Promise<string | null>;
  connectionSnapshot(): ConnectionSnapshot;
  qrSnapshot(): QrSnapshot;
};
