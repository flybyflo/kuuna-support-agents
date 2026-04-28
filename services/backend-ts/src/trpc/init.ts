import { initTRPC, TRPCError } from "@trpc/server";

import { requireAuth, type AuthContext, type RoleName } from "../auth.js";
import { db, type Database, type DbLike } from "../db/client.js";
import { applyRlsContext } from "../rls.js";

export type TrpcContext = {
  headers: Headers;
  clientIp: string;
  rootDb: Database;
  db: DbLike;
  auth: AuthContext | null;
};

export async function createTRPCContext(opts: {
  headers: Headers;
  clientIp?: string;
  db?: Database;
}): Promise<TrpcContext> {
  const database = opts.db ?? db;
  return {
    headers: opts.headers,
    clientIp: opts.clientIp ?? "unknown",
    rootDb: database,
    db: database,
    auth: null,
  };
}

const t = initTRPC.context<TrpcContext>().create();

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const auth = requireAuth(ctx.headers);
  return ctx.rootDb.transaction(async (tx) => {
    await applyRlsContext(tx, auth);
    return next({
      ctx: {
        ...ctx,
        rootDb: ctx.rootDb,
        db: tx,
        auth,
      },
    });
  });
});

export function roleProcedure(...allowedRoles: RoleName[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    if (!allowedRoles.includes(ctx.auth.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "insufficient role" });
    }
    return next();
  });
}
