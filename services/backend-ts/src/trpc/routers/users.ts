import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { DbLike } from "../../db/client.js";
import { roles, userRoles, users, groupAssignments } from "../../db/schema.js";
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
    return {
      id: user.id,
      email: user.email,
      is_active: user.isActive,
      must_change_password: user.mustChangePassword,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }),
});
