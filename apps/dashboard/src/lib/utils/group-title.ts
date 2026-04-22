import type { GroupBinding } from "@/lib/api-client/types";
import type { WhatsAppGatewayGroup } from "@/lib/whatsapp/ops";
import { titleFromGroupId } from "@/lib/utils/format";

/**
 * Resolve the best available human-readable title for a WhatsApp group.
 *
 * Cascade (most authoritative first):
 *   1. live gateway groupTitle (reflects the current WhatsApp group name)
 *   2. stored binding.groupTitle (captured when the group was bound)
 *   3. a fallback already known to the caller (e.g. PromptAsset.instanceName)
 *   4. derived from the provider group JID
 */
export function resolveGroupTitle(options: {
  providerGroupId: string;
  bindings?: GroupBinding[];
  gatewayGroups?: WhatsAppGatewayGroup[];
  fallback?: string;
}): string {
  const { providerGroupId, bindings, gatewayGroups, fallback } = options;

  const gatewayTitle = gatewayGroups
    ?.find((group) => group.providerGroupId === providerGroupId)
    ?.groupTitle?.trim();
  if (gatewayTitle) return gatewayTitle;

  const bindingTitle = bindings
    ?.find((binding) => binding.providerGroupId === providerGroupId)
    ?.groupTitle?.trim();
  if (bindingTitle) return bindingTitle;

  const fallbackTitle = fallback?.trim();
  if (fallbackTitle) return fallbackTitle;

  return titleFromGroupId(providerGroupId);
}

/**
 * Resolve by bindingId instead of providerGroupId. Returns `undefined` if we
 * can't find the binding (so callers can pick their own fallback rendering).
 */
export function resolveGroupTitleByBindingId(options: {
  bindingId: string;
  bindings?: GroupBinding[];
  gatewayGroups?: WhatsAppGatewayGroup[];
  fallback?: string;
}): string | undefined {
  const { bindingId, bindings, gatewayGroups, fallback } = options;
  const binding = bindings?.find((item) => item.id === bindingId);
  if (!binding) {
    return fallback?.trim() || undefined;
  }

  return resolveGroupTitle({
    providerGroupId: binding.providerGroupId,
    bindings,
    gatewayGroups,
    fallback,
  });
}
