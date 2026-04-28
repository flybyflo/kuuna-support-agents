import { runtimeAgentRequestSchema } from "@kuuna/agent-contracts";
import { initTRPC } from "@trpc/server";

import { runAgent } from "./runner.js";

const t = initTRPC.create();

export const runtimeAgentRouter = t.router({
  agent: t.router({
    run: t.procedure
      .input(runtimeAgentRequestSchema)
      .mutation(({ input }) => runAgent(input)),
  }),
});

export type RuntimeAgentRouter = typeof runtimeAgentRouter;
