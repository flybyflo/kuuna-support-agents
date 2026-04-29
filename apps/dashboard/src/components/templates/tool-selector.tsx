"use client";

import { Search, SquareCheckBig, SquareMinus } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { ToolCatalogItem } from "@/lib/api-client/types";

type ToolSelectorProps = {
  tools: ToolCatalogItem[];
  defaultSelectedToolKeys: string[];
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function matchesTool(tool: ToolCatalogItem, query: string): boolean {
  if (!query) {
    return true;
  }
  return `${tool.displayName} ${tool.toolKey} ${tool.category} ${tool.description}`
    .toLowerCase()
    .includes(query);
}

export function ToolSelector({
  tools,
  defaultSelectedToolKeys,
}: ToolSelectorProps) {
  const enabledTools = useMemo(
    () =>
      tools
        .filter(
          (tool) =>
            tool.isEnabled &&
            tool.toolKey !== "context_lookup" &&
            tool.toolKey !== "knowledge_search" &&
            tool.toolKey !== "chat_history_search" &&
            tool.toolKey !== "send_whatsapp",
        )
        .sort((left, right) =>
          `${left.category}:${left.displayName}`.localeCompare(
            `${right.category}:${right.displayName}`,
          ),
        ),
    [tools],
  );
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => {
      const enabledKeys = new Set(enabledTools.map((tool) => tool.toolKey));
      return new Set(defaultSelectedToolKeys.filter((key) => enabledKeys.has(key)));
    },
  );

  const filteredTools = useMemo(() => {
    const search = normalized(query);
    return enabledTools.filter((tool) => matchesTool(tool, search));
  }, [enabledTools, query]);

  function setToolSelected(toolKey: string, checked: boolean) {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(toolKey);
      } else {
        next.delete(toolKey);
      }
      return next;
    });
  }

  return (
    <FormRow
      label="Other allowed tools"
      htmlFor="allowedToolSearch"
      hint="Knowledge and chat-history search are controlled by the search policy below."
    >
      <input type="hidden" name="allowedToolSelection" value="explicit" />
      {Array.from(selectedKeys).map((toolKey) => (
        <input key={toolKey} type="hidden" name="allowedTool" value={toolKey} />
      ))}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="allowedToolSearch"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Find tool"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSelectedKeys(new Set(filteredTools.map((tool) => tool.toolKey)))
            }
          >
            <SquareCheckBig />
            Visible
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedKeys(new Set())}
          >
            <SquareMinus />
            Clear
          </Button>
        </div>

        <div className="max-h-[260px] overflow-auto rounded-md border border-border bg-background">
          {filteredTools.length ? (
            filteredTools.map((tool) => (
              <label
                key={tool.id}
                className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0"
              >
                <Checkbox
                  checked={selectedKeys.has(tool.toolKey)}
                  onChange={(event) =>
                    setToolSelected(tool.toolKey, event.target.checked)
                  }
                  aria-label={`Allow ${tool.displayName}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {tool.displayName}
                    </span>
                    <Badge variant={tool.riskClass === "write" ? "warning" : "secondary"}>
                      {tool.riskClass}
                    </Badge>
                    <Badge variant="outline">{tool.category}</Badge>
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                    {tool.toolKey}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {tool.description}
                  </span>
                </span>
              </label>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No tools match.
            </p>
          )}
        </div>
      </div>
    </FormRow>
  );
}
