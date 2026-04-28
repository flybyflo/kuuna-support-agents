import { tracked, TRPCError } from "@trpc/server";
import { z } from "zod";

import { runtimeEventTypeSchema, subscribeRuntimeEvents } from "../../runtime/events.js";
import { authenticatedProcedure, createTRPCRouter } from "../init.js";

const subscriptionInputSchema = z.object({
  providerGroupId: z.string().nullable().optional(),
  types: z.array(runtimeEventTypeSchema).optional(),
}).optional();

export const runtimeEventsRouter = createTRPCRouter({
  onEvent: authenticatedProcedure
    .input(subscriptionInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      const providerGroupId = input?.providerGroupId ?? null;
      const types = input?.types ? new Set(input.types) : null;

      if (
        providerGroupId &&
        ctx.auth?.role !== "owner" &&
        ctx.auth?.role !== "admin" &&
        !ctx.auth?.groupScope.includes(providerGroupId)
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "group outside auth scope" });
      }

      const subscriptionSignal: AbortSignal = signal ?? new AbortController().signal;
      for await (const event of subscribeRuntimeEvents(subscriptionSignal)) {
        if (providerGroupId && event.provider_group_id !== providerGroupId) continue;
        if (types && !types.has(event.type)) continue;
        yield tracked(event.id, event);
      }
    }),
});
