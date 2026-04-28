import pino, { type Logger } from "pino";
import qrcode from "qrcode-terminal";

import { BackendIngestClient } from "./backend.js";
import { mapBaileysMessage, isSelfMessage } from "./mapping.js";
import { GatewayConnectionStatus, GatewayQrStatus } from "./status.js";
import type { ConnectionSnapshot, GatewayClient, GatewayGroup, QrSnapshot } from "./types.js";

type AnyRecord = Record<string, unknown>;
type BaileysModule = typeof import("@whiskeysockets/baileys");
type WASocket = import("@whiskeysockets/baileys").WASocket;

export class BaileysGateway implements GatewayClient {
  private socket: WASocket | null = null;
  private module: BaileysModule | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private starting: Promise<void> | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly input: {
      authDir: string;
      sessionName: string;
      backendClient: BackendIngestClient;
      connectionStatus: GatewayConnectionStatus;
      qrStatus: GatewayQrStatus;
      logLevel?: string;
      printQrToConsole?: boolean;
      qrRenderer?: (qr: string) => void;
      socketFactory?: (config: unknown) => WASocket;
      baileysModule?: BaileysModule;
    },
  ) {
    this.logger = pino({ level: input.logLevel ?? "info" });
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.openSocket().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end(new Error("gateway stopped"));
      this.socket = null;
    }
  }

  async listGroups(): Promise<GatewayGroup[]> {
    const socket = this.requireSocket();
    const groups = await socket.groupFetchAllParticipating();
    return (Object.values(groups) as Array<{ id: string; subject?: string; participants?: unknown[] }>)
      .map((group) => ({
        jid: group.id,
        name: group.subject?.trim() || group.id,
        participants_count: group.participants?.length ?? 0,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createGroup(name: string, participants: string[]): Promise<GatewayGroup> {
    const socket = this.requireSocket();
    const group = await socket.groupCreate(name, participants);
    return {
      jid: group.id,
      name: group.subject?.trim() || name,
      participants_count: group.participants?.length ?? participants.length,
    };
  }

  async sendText(input: {
    providerGroupId: string;
    text: string;
    replyToProviderMessageId?: string | null;
  }): Promise<string | null> {
    const socket = this.requireSocket();
    const response = await socket.sendMessage(input.providerGroupId, { text: input.text });
    return response?.key?.id ?? null;
  }

  connectionSnapshot(): ConnectionSnapshot {
    return this.input.connectionStatus.snapshot();
  }

  qrSnapshot(): QrSnapshot {
    return this.input.qrStatus.snapshot();
  }

  private async openSocket(): Promise<void> {
    this.stopping = false;
    this.input.connectionStatus.markDisconnected("connecting");
    const baileys = await this.loadBaileys();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.input.authDir);
    this.saveCreds = saveCreds;
    const version = await this.resolveBaileysVersion(baileys);

    const socketFactory = this.input.socketFactory ?? ((config: unknown) => baileys.makeWASocket(config as never));
    const logger = this.logger.child({ component: "baileys" });
    const auth =
      typeof baileys.makeCacheableSignalKeyStore === "function"
        ? { creds: state.creds, keys: baileys.makeCacheableSignalKeyStore(state.keys, logger) }
        : state;

    const socket = socketFactory({
      auth,
      ...(version ? { version } : {}),
      logger,
      browser: baileys.Browsers.appropriate(this.input.sessionName),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined,
    } as AnyRecord);
    this.socket = socket;
    this.registerHandlers(socket, baileys);
  }

  private async loadBaileys(): Promise<BaileysModule> {
    if (this.module) return this.module;
    this.module = this.input.baileysModule ?? (await import("@whiskeysockets/baileys"));
    return this.module;
  }

  private async resolveBaileysVersion(baileys: BaileysModule): Promise<unknown[] | null> {
    try {
      const result = await baileys.fetchLatestBaileysVersion();
      return result.version;
    } catch (error) {
      this.logger.warn({
        event: "gateway_baileys_version_lookup_failed",
        error: errorMessage(error),
      });
      return null;
    }
  }

  private registerHandlers(socket: WASocket, baileys: BaileysModule): void {
    socket.ev.on("connection.update", (update: AnyRecord) => {
      const qr = typeof update.qr === "string" ? update.qr : null;
      if (qr) {
        this.input.qrStatus.setQr(qr);
        this.input.connectionStatus.markDisconnected(
          "qr",
          "pairing required - scan the QR code printed in gateway logs or query gateway ops QR over tRPC",
        );
        this.printQr(qr);
      }

      if (update.connection === "open") {
        this.input.qrStatus.clear();
        this.input.connectionStatus.markConnected("connected");
        this.logger.info({ event: "gateway_connected" });
        return;
      }

      if (update.connection === "connecting") {
        this.input.connectionStatus.markDisconnected("connecting");
        return;
      }

      if (update.connection === "close") {
        const statusCode = disconnectStatusCode(update.lastDisconnect);
        const reason = errorMessage(update.lastDisconnect);
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        this.input.connectionStatus.markDisconnected(loggedOut ? "logged_out" : "disconnected", reason);
        this.logger.warn({ event: "gateway_disconnected", status_code: statusCode, reason });
        if (!loggedOut && !this.stopping) {
          this.scheduleReconnect();
        }
      }
    });

    socket.ev.on("creds.update", () => {
      void this.saveCreds?.().catch((error) => {
        this.logger.error({ event: "gateway_creds_save_failed", error: errorMessage(error) });
      });
    });

    socket.ev.on("messages.upsert", (event: { messages?: unknown }) => {
      void this.handleMessages(Array.isArray(event.messages) ? event.messages as AnyRecord[] : []).catch((error) => {
        this.logger.error({ event: "gateway_messages_upsert_failed", error: errorMessage(error) });
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch((error) => {
        this.input.connectionStatus.markDisconnected("reconnect_failed", errorMessage(error));
        this.logger.error({ event: "gateway_reconnect_failed", error: errorMessage(error) });
        this.scheduleReconnect();
      });
    }, 3000);
  }

  private async handleMessages(messages: AnyRecord[]): Promise<void> {
    for (const message of messages) {
      if (!message.message || isSelfMessage(message)) continue;
      const payload = mapBaileysMessage(message);
      try {
        const response = await this.input.backendClient.sendInboundPayload(payload);
        this.logger.info({
          event: "gateway_inbound_forwarded",
          trace_id: response.trace_id,
          provider_group_id: payload.provider_group_id,
          provider_message_id: payload.provider_message_id,
          deduped: response.deduped,
          execution_enqueued: response.execution_enqueued,
        });
      } catch (error) {
        this.logger.error({
          event: "gateway_inbound_forward_failed",
          trace_id: payload.trace_id,
          provider_group_id: payload.provider_group_id,
          provider_message_id: payload.provider_message_id,
          error: errorMessage(error),
        });
      }
    }
  }

  private printQr(qr: string): void {
    if (this.input.printQrToConsole === false) return;
    const render = this.input.qrRenderer ?? ((value: string) => qrcode.generate(value, { small: true }));
    this.logger.info({
      event: "gateway_pairing_qr_available",
      auth_dir: this.input.authDir,
      message: "Scan this QR code in WhatsApp Linked Devices.",
    });
    render(qr);
  }

  private requireSocket(): WASocket {
    if (!this.socket) {
      throw new Error("baileys socket is not initialized");
    }
    return this.socket;
  }
}

function disconnectStatusCode(value: unknown): number | null {
  const error = objectRecord(objectRecord(value).error);
  const output = objectRecord(error.output);
  const statusCode = output.statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const nested = (error as { error?: unknown }).error;
    if (nested instanceof Error) return nested.message;
  }
  return String(error);
}

function objectRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}
