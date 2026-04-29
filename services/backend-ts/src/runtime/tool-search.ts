import {
  runtimeToolSearchRequestSchema,
  type RuntimeToolSearchRequest,
  type RuntimeToolSearchResponse,
} from "@kuuna/agent-contracts";
import { and, eq } from "drizzle-orm";

import type { DbLike } from "../db/client.js";
import {
  agentInstances,
  groupBindings,
  groupClientProfiles,
  groupMembers,
  templateVersions,
} from "../db/schema.js";
import {
  retrieveScopedRuntimeContext,
  type RetrievalAccessContext,
} from "../jobs/retrieval.js";

const runtimeToolSourceTypes = {
  chat_history_search: ["message", "message_link", "media_asset"],
  knowledge_search: ["knowledge_version"],
} as const;

export class RuntimeToolSearchError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RuntimeToolSearchError";
    this.statusCode = statusCode;
  }
}

export async function searchRuntimeTool(
  database: DbLike,
  rawInput: unknown,
): Promise<RuntimeToolSearchResponse> {
  const input = runtimeToolSearchRequestSchema.parse(rawInput);
  const target = await resolveRuntimeToolTarget(database, input);
  const allowedTools = extractAllowedTools(target.templateVersion.toolsConfig);
  if (!allowedTools.includes(input.tool_name)) {
    throw new RuntimeToolSearchError(403, `runtime tool '${input.tool_name}' is not allowed by template`);
  }

  const access = await resolveRetrievalAccess(database, {
    providerGroupId: target.providerGroupId,
    bindingId: target.bindingId,
    agentInstanceId: target.agentInstanceId,
    senderProviderUserId: input.context.sender_provider_user_id ?? null,
  });
  const result = await retrieveScopedRuntimeContext(database, {
    query: input.query,
    limit: input.limit,
    toolsConfig: target.templateVersion.toolsConfig,
    access,
    sourceTypes: [...runtimeToolSourceTypes[input.tool_name]],
    allowBoundConversationScope: input.tool_name === "chat_history_search",
  });

  return {
    tool_name: input.tool_name,
    query: input.query,
    hits: result.hits,
    access: result.access as Record<string, unknown>,
  };
}

async function resolveRuntimeToolTarget(database: DbLike, input: RuntimeToolSearchRequest) {
  const rows = await database
    .select({
      binding: groupBindings,
      agentInstance: agentInstances,
      templateVersion: templateVersions,
    })
    .from(agentInstances)
    .innerJoin(groupBindings, eq(groupBindings.id, agentInstances.groupBindingId))
    .innerJoin(templateVersions, eq(templateVersions.id, groupBindings.templateVersionId))
    .where(
      and(
        eq(agentInstances.id, input.context.agent_instance_id),
        eq(groupBindings.id, input.context.binding_id),
        eq(groupBindings.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new RuntimeToolSearchError(403, "runtime identity is not bound to an active group");
  }
  if (row.binding.providerGroupId !== input.context.provider_group_id) {
    throw new RuntimeToolSearchError(403, "runtime identity provider_group_id mismatch");
  }
  return {
    providerGroupId: row.binding.providerGroupId,
    bindingId: row.binding.id,
    agentInstanceId: row.agentInstance.id,
    templateVersion: row.templateVersion,
  };
}

async function resolveRetrievalAccess(
  database: DbLike,
  input: {
    providerGroupId: string;
    bindingId: string;
    agentInstanceId: string;
    senderProviderUserId: string | null;
  },
): Promise<RetrievalAccessContext> {
  const [member] = input.senderProviderUserId
    ? await database
        .select({
          role: groupMembers.role,
          clientProfileId: groupMembers.clientProfileId,
        })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.providerGroupId, input.providerGroupId),
            eq(groupMembers.providerUserId, input.senderProviderUserId),
          ),
        )
        .limit(1)
    : [];

  const [primary] = await database
    .select({ clientProfileId: groupClientProfiles.clientProfileId })
    .from(groupClientProfiles)
    .where(and(eq(groupClientProfiles.providerGroupId, input.providerGroupId), eq(groupClientProfiles.isPrimary, true)))
    .limit(1);

  return {
    providerGroupId: input.providerGroupId,
    bindingId: input.bindingId,
    agentInstanceId: input.agentInstanceId,
    senderProviderUserId: input.senderProviderUserId,
    senderRole: member?.role ?? null,
    primaryClientProfileId: primary?.clientProfileId ?? null,
    authorizedPersonalProfileIds: primary?.clientProfileId ? [primary.clientProfileId] : [],
  };
}

function extractAllowedTools(toolsConfig: unknown): string[] {
  if (!toolsConfig || typeof toolsConfig !== "object" || Array.isArray(toolsConfig)) return [];
  const config = toolsConfig as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["allowed_tools", "allowedTools"]) {
    const value = config[key];
    if (Array.isArray(value)) candidates.push(...value.filter((item): item is string => typeof item === "string"));
  }
  const tools = config.tools;
  if (Array.isArray(tools)) {
    for (const item of tools) {
      if (typeof item === "string") candidates.push(item);
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        if (typeof record.name === "string" && record.name && record.enabled !== false) candidates.push(record.name);
      }
    }
  }
  const normalized: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim().toLowerCase();
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized;
}
