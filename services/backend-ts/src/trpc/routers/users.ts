import { eq } from "drizzle-orm";

import { roles, userRoles, users, groupAssignments } from "../../db/schema.js";
import { createTRPCRouter, roleProcedure } from "../init.js";

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
});
