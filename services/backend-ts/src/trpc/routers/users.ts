import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { DbLike } from "../../db/client.js";
import { auditEvents, roles, userRoles, users, groupAssignments } from "../../db/schema.js";
import { hashPassword, passwordPolicyViolations, type RoleName } from "../../auth.js";
import { createTRPCRouter, roleProcedure } from "../init.js";

const userCreateInput = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(255),
  roles: z.array(z.enum(["owner", "admin", "operator", "viewer"])).default(["viewer"]),
  groupScope: z.array(z.string().trim().min(1).max(255)).default([]),
  mustChangePassword: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const userUpdateInput = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

const userIdInput = z.object({
  userId: z.string().uuid(),
});

async function replaceRoles(database: DbLike, userId: string, roleNames: RoleName[]) {
  const uniqueRoles = Array.from(new Set(roleNames.length ? roleNames : ["viewer"])).sort() as RoleName[];
  await database.delete(userRoles).where(eq(userRoles.userId, userId));
  const roleRows = await database.select().from(roles).where(inArray(roles.name, uniqueRoles));
  const existing = new Map(roleRows.map((role) => [role.name, role.id]));
  for (const roleName of uniqueRoles) {
    let roleId = existing.get(roleName);
    if (!roleId) {
      const [role] = await database.insert(roles).values({ name: roleName }).returning();
      roleId = role?.id;
    }
    if (roleId) {
      await database.insert(userRoles).values({ userId, roleId });
    }
  }
}

async function replaceAssignments(database: DbLike, userId: string, groupScope: string[]) {
  await database.delete(groupAssignments).where(eq(groupAssignments.userId, userId));
  for (const providerGroupId of Array.from(new Set(groupScope)).sort()) {
    await database.insert(groupAssignments).values({ userId, providerGroupId });
  }
}

export const usersRouter = createTRPCRouter({
  list: roleProcedure("owner", "admin").query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(users).orderBy(users.email);
    const roleRows = await ctx.db
      .select({ userId: userRoles.userId, role: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id));
    const assignmentRows = await ctx.db.select().from(groupAssignments);

    return rows.map((user) => ({
      id: user.id,
      email: user.email,
      must_change_password: user.mustChangePassword,
      is_active: user.isActive,
      roles: roleRows.filter((role) => role.userId === user.id).map((role) => role.role),
      group_scope: assignmentRows
        .filter((assignment) => assignment.userId === user.id)
        .map((assignment) => assignment.providerGroupId),
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    }));
  }),

  assignments: roleProcedure("owner", "admin").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: groupAssignments.id,
        userId: groupAssignments.userId,
        email: users.email,
        providerGroupId: groupAssignments.providerGroupId,
        createdAt: groupAssignments.createdAt,
        updatedAt: groupAssignments.updatedAt,
      })
      .from(groupAssignments)
      .innerJoin(users, eq(groupAssignments.userId, users.id));

    return rows.map((row) => ({
      id: row.id,
      user_id: row.userId,
      user_email: row.email,
      provider_group_id: row.providerGroupId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }),

  create: roleProcedure("owner", "admin").input(userCreateInput).mutation(async ({ ctx, input }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    const violations = passwordPolicyViolations(input.password);
    if (violations.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `password policy violation: ${violations.join("; ")}`,
      });
    }
    const normalizedEmail = input.email.toLowerCase();
    const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "email already exists" });
    }
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash: hashPassword(input.password),
        mustChangePassword: input.mustChangePassword,
        isActive: input.isActive,
        passwordChangedAt: new Date(),
      })
      .returning();
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user creation failed" });
    }
    await replaceRoles(ctx.db, user.id, input.roles);
    await replaceAssignments(ctx.db, user.id, input.groupScope);
    await ctx.db.insert(auditEvents).values({
      actorUserId: ctx.auth.userId,
      eventType: "user.created",
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email, roles: input.roles },
    });
    return {
      id: user.id,
      email: user.email,
      is_active: user.isActive,
      must_change_password: user.mustChangePassword,
      roles: input.roles,
      group_scope: input.groupScope,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }),

  update: roleProcedure("owner", "admin").input(userUpdateInput).mutation(async ({ ctx, input }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    const [before] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!before) {
      throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    }
    const [user] = await ctx.db
      .update(users)
      .set({
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.mustChangePassword !== undefined
          ? { mustChangePassword: input.mustChangePassword }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))
      .returning();
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    }
    await ctx.db.insert(auditEvents).values({
      actorUserId: ctx.auth.userId,
      eventType: "user.updated",
      entityType: "user",
      entityId: user.id,
      payload: {
        before: {
          is_active: before.isActive,
          must_change_password: before.mustChangePassword,
        },
        after: {
          is_active: user.isActive,
          must_change_password: user.mustChangePassword,
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      is_active: user.isActive,
      must_change_password: user.mustChangePassword,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }),

  delete: roleProcedure("owner", "admin").input(userIdInput).mutation(async ({ ctx, input }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "missing auth context" });
    }
    if (ctx.auth.userId === input.userId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "cannot hard-delete current user" });
    }
    const [user] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    }

    await ctx.db.insert(auditEvents).values({
      actorUserId: ctx.auth.userId,
      eventType: "user.hard_deleted",
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email },
    });
    await ctx.db.delete(groupAssignments).where(eq(groupAssignments.userId, user.id));
    await ctx.db.delete(userRoles).where(eq(userRoles.userId, user.id));
    await ctx.db.delete(users).where(eq(users.id, user.id));
    return { deleted: true };
  }),
});
