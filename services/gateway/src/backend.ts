import type { GatewayInboundEvent } from "./types.js";

export class BackendIngestClient {
  constructor(
    private readonly input: {
      backendBaseUrl: string;
      serviceToken?: string | null;
      httpClient?: typeof fetch;
    },
  ) {}

  async sendInboundPayload(payload: GatewayInboundEvent): Promise<Response> {
    const httpClient = this.input.httpClient ?? fetch;
    return httpClient(`${this.input.backendBaseUrl.replace(/\/$/, "")}/gateway/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.input.serviceToken ? { authorization: `Bearer ${this.input.serviceToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  }
}
