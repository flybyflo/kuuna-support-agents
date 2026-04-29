import { createTRPCRouter, publicProcedure } from "../init.js";
import { agentStateRouter } from "./agent-state.js";
import { auditRouter } from "./audit.js";
import { authRouter } from "./auth.js";
import { bindingsRouter } from "./bindings.js";
import { gatewayRouter } from "./gateway.js";
import { internalRouter } from "./internal.js";
import { knowledgeRouter } from "./knowledge.js";
import { messagesRouter } from "./messages.js";
import { runtimeEventsRouter } from "./runtime-events.js";
import { templatesRouter } from "./templates.js";
import { toolsRouter } from "./tools.js";
import { usersRouter } from "./users.js";

export const appRouter = createTRPCRouter({
  system: createTRPCRouter({
    health: publicProcedure.query(() => ({ status: "ok", service: "backend-ts" })),
  }),
  auth: authRouter,
  users: usersRouter,
  templates: templatesRouter,
  tools: toolsRouter,
  bindings: bindingsRouter,
  messages: messagesRouter,
  runtimeEvents: runtimeEventsRouter,
  agentState: agentStateRouter,
  knowledge: knowledgeRouter,
  audit: auditRouter,
  gateway: gatewayRouter,
  internal: internalRouter,
});

export type AppRouter = typeof appRouter;
