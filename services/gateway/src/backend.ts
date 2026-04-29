import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { BackendGatewayContractRouter, GatewayInboundAck, GatewayInboundEvent } from "@kuuna/contracts";

export type BackendIngestTransport = (payload: GatewayInboundEvent) => Promise<GatewayInboundAck>;

export class BackendIngestClient {
  constructor(
    private readonly input: {
      backendBaseUrl: string;
      serviceToken?: string | null;
      timeoutMs?: number;
      transport?: BackendIngestTransport;
    },
  ) {}

  async sendInboundPayload(payload: GatewayInboundEvent): Promise<GatewayInboundAck> {
    if (this.input.transport) {
      return this.input.transport(payload);
    }
    const client = createTRPCClient<BackendGatewayContractRouter>({
      links: [
        httpLink({
          url: `${this.input.backendBaseUrl.replace(/\/$/, "")}/trpc`,
          headers: this.input.serviceToken ? { authorization: `Bearer ${this.input.serviceToken}` } : {},
          fetch: (url, init) =>
            fetch(url, {
              ...init,
              signal: AbortSignal.timeout(this.input.timeoutMs ?? 10_000),
            }),
        }),
      ],
    });
    try {
      return await client.gateway.inbound.ingest.mutate(payload);
    } catch (error) {
      if (error instanceof TRPCClientError) {
        throw new Error(`backend_trpc_error: ${error.message}`);
      }
      throw error;
    }
  }
}
