import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getCurrentUser,
  issueAccessToken,
  passwordPolicyViolations,
  resolveScopeForUser,
  verifyPassword,
  hashPassword,
} from "../../auth.js";
import { getSettings } from "../../config.js";
import { auditEvents, users } from "../../db/schema.js";
import { loginRateLimiter } from "../../rate-limit.js";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../init.js";

const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const authRouter = createTRPCRouter({
  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    loginRateLimiter.record(ctx.clientIp);

    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid credentials" });
    }

    if (!user.isActive) {
      throw new TRPCError({ code: "FORBIDDEN", message: "inactive user" });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new TRPCError({ code: "FORBIDDEN", message: "user locked" });
    }

    if (!verifyPassword(input.password, user.passwordHash)) {
      const failedLoginCount = user.failedLoginCount + 1;
      const settings = getSettings();
      const lockedUntil =
        failedLoginCount >= settings.AUTH_LOCKOUT_THRESHOLD
          ? new Date(Date.now() + settings.AUTH_LOCKOUT_SECONDS * 1000)
          : null;

      await ctx.db
        .update(users)
        .set({
          failedLoginCount: lockedUntil ? 0 : failedLoginCount,
          lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      if (lockedUntil) {
        await ctx.db.insert(auditEvents).values({
          eventType: "auth.account_locked",
          entityType: "user",
          entityId: user.id,
          payload: {
            locked_until: lockedUntil.toISOString(),
            lockout_seconds: settings.AUTH_LOCKOUT_SECONDS,
          },
        });
      }

      throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid credentials" });
    }

    await ctx.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const scope = await resolveScopeForUser(ctx.db, user.id);
    return {
      access_token: issueAccessToken({
        userId: user.id,
        role: scope.role,
        groupScope: scope.groupScope,
      }),
      token_type: "bearer",
      expires_in: getSettings().AUTH_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        must_change_password: user.mustChangePassword,
        role: scope.role,
        group_scope: scope.groupScope,
      },
    };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    const user = await getCurrentUser(ctx.db, ctx.auth);
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "inactive or missing user" });
    }
    const scope = await resolveScopeForUser(ctx.db, user.id);
    return {
      id: user.id,
      email: user.email,
      must_change_password: user.mustChangePassword,
      is_active: user.isActive,
      role: scope.role,
      group_scope: scope.groupScope,
    };
  }),

  changePassword: protectedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.id, ctx.auth.userId), eq(users.isActive, true)))
      .limit(1);

    if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid current password" });
    }

    const violations = passwordPolicyViolations(input.newPassword);
    if (violations.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `password policy violation: ${violations.join("; ")}`,
      });
    }

    await ctx.db
      .update(users)
      .set({
        passwordHash: hashPassword(input.newPassword),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const scope = await resolveScopeForUser(ctx.db, user.id);
    return {
      id: user.id,
      email: user.email,
      must_change_password: false,
      is_active: user.isActive,
      role: scope.role,
      group_scope: scope.groupScope,
    };
  }),
});
