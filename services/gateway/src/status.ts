import type { ConnectionSnapshot, QrSnapshot } from "./types.js";

function utcNowIso(): string {
  return new Date().toISOString();
}

export class GatewayConnectionStatus {
  private connected = false;
  private lastEvent = "startup";
  private lastChangedAt = utcNowIso();
  private lastError: string | null = null;

  markConnected(event: string, error: string | null = null): void {
    this.connected = true;
    this.lastEvent = event;
    this.lastChangedAt = utcNowIso();
    this.lastError = error;
  }

  markDisconnected(event: string, error: string | null = null): void {
    this.connected = false;
    this.lastEvent = event;
    this.lastChangedAt = utcNowIso();
    this.lastError = error;
  }

  snapshot(): ConnectionSnapshot {
    return {
      connected: this.connected,
      last_event: this.lastEvent,
      last_changed_at: this.lastChangedAt,
      checked_at: utcNowIso(),
      last_error: this.lastError,
    };
  }
}

export class GatewayQrStatus {
  private currentQr: string | null = null;
  private updatedAt = utcNowIso();

  setQr(qr: string): void {
    const trimmed = qr.trim();
    if (!trimmed) return;
    this.currentQr = trimmed;
    this.updatedAt = utcNowIso();
  }

  clear(): void {
    this.currentQr = null;
    this.updatedAt = utcNowIso();
  }

  snapshot(): QrSnapshot {
    return {
      qr: this.currentQr,
      updated_at: this.updatedAt,
    };
  }
}
