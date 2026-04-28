export type GatewayEventType =
  | "message_created"
  | "message_edited"
  | "message_deleted";

export interface GatewayInboundMedia {
  provider_media_id: string;
  mime_type: string;
  file_name?: string | null;
  byte_size?: number | null;
  download_url?: string | null;
  inline_data_base64?: string | null;
}

export interface GatewayInboundMessage {
  text?: string | null;
  reply_to_provider_message_id?: string | null;
  mentions: string[];
  media: GatewayInboundMedia[];
}

export interface GatewayInboundEvent {
  trace_id: string;
  provider: "whatsapp-neonize";
  provider_group_id: string;
  provider_message_id: string;
  sender_provider_user_id?: string | null;
  event_type: GatewayEventType;
  occurred_at: string;
  message: GatewayInboundMessage;
  raw_event?: Record<string, unknown> | null;
}

export interface GatewayOutboundIntent {
  trace_id: string;
  outbound_intent_id: string;
  provider_group_id: string;
  reply_to_provider_message_id?: string | null;
  text: string;
  metadata: {
    agent_instance_id: string;
    model_path: string[];
  };
}

export interface GatewayOutboundStatusEvent {
  trace_id: string;
  outbound_intent_id: string;
  status: "sent" | "failed" | "retrying";
  provider_message_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  occurred_at: string;
}
