import { sql } from "drizzle-orm";

import type { DbLike } from "./db/client.js";
import type { AuthContext } from "./auth.js";

export async function applyRlsContext(database: DbLike, auth: AuthContext | null): Promise<void> {
  await database.execute(sql`
    select
      set_config('app.role', ${auth?.role ?? ""}, true),
      set_config('app.group_scope', ${auth?.groupScope.join(",") ?? ""}, true)
  `);
}
