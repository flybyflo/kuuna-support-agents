export type {
  GatewayEventType,
  GatewayInboundEvent,
  GatewayInboundMedia,
  GatewayInboundMessage,
  GatewayOutboundIntent,
  GatewayOutboundStatusEvent,
} from "@kuuna/contracts";

export type GatewayGroup = {
  jid: string;
  name: string;
  participants_count: number;
};

export type GatewayGroupParticipant = {
  jid: string;
  phone: string | null;
  display_name: string | null;
  is_admin: boolean | null;
  is_self: boolean;
  metadata: Record<string, unknown>;
};

export type GatewaySelfIdentity = {
  jid: string | null;
  phone: string | null;
  display_name: string | null;
  metadata: Record<string, unknown>;
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
  listGroupParticipants(providerGroupId: string): Promise<GatewayGroupParticipant[]>;
  selfIdentity(): GatewaySelfIdentity;
  createGroup(name: string, participants: string[]): Promise<GatewayGroup>;
  sendText(input: {
    providerGroupId: string;
    text: string;
    replyToProviderMessageId?: string | null;
  }): Promise<string | null>;
  connectionSnapshot(): ConnectionSnapshot;
  qrSnapshot(): QrSnapshot;
};
