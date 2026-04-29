"use client";

import { Search, SquareCheckBig, SquareMinus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  PrivateKnowledgeDocKey,
  WorkflowStatus,
} from "@/lib/api-client/types";

type KnowledgeMode = "all" | "selected" | "none";

type CompanyKnowledgeOption = {
  id: string;
  docKey: string;
  title: string;
  status: WorkflowStatus;
};

type SearchableKnowledgeSelectorProps = {
  companyDocs: CompanyKnowledgeOption[];
  privateDocKeys: PrivateKnowledgeDocKey[];
  defaultCompanyMode: KnowledgeMode;
  defaultCompanyDocKeys: string[];
  defaultPrivateMode: KnowledgeMode;
  defaultPrivateDocKeys: string[];
  defaultIncludeChatHistorySearch: boolean;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(
  option: { title: string; docKey: string },
  query: string,
): boolean {
  if (!query) {
    return true;
  }

  const haystack = `${option.title} ${option.docKey}`.toLowerCase();
  return haystack.includes(query);
}

function countLabel(doc: PrivateKnowledgeDocKey): string {
  const parts = [
    doc.groupCount ? `${doc.groupCount} group` : null,
    doc.customerCount ? `${doc.customerCount} customer` : null,
    doc.personalCount ? `${doc.personalCount} personal` : null,
  ].filter(Boolean);
  return parts.join(" / ");
}

export function SearchableKnowledgeSelector({
  companyDocs,
  privateDocKeys,
  defaultCompanyMode,
  defaultCompanyDocKeys,
  defaultPrivateMode,
  defaultPrivateDocKeys,
  defaultIncludeChatHistorySearch,
}: SearchableKnowledgeSelectorProps) {
  const [companyMode, setCompanyMode] =
    useState<KnowledgeMode>(defaultCompanyMode);
  const [privateMode, setPrivateMode] =
    useState<KnowledgeMode>(defaultPrivateMode);
  const [companyQuery, setCompanyQuery] = useState("");
  const [privateQuery, setPrivateQuery] = useState("");
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<Set<string>>(
    () =>
      new Set(
        defaultCompanyMode === "all"
          ? companyDocs.map((doc) => doc.docKey)
          : defaultCompanyDocKeys,
      ),
  );
  const [selectedPrivateKeys, setSelectedPrivateKeys] = useState<Set<string>>(
    () =>
      new Set(
        defaultPrivateMode === "all"
          ? privateDocKeys.map((doc) => doc.docKey)
          : defaultPrivateDocKeys,
      ),
  );

  const filteredCompanyDocs = useMemo(() => {
    const query = normalized(companyQuery);
    return companyDocs.filter((doc) => matchesSearch(doc, query));
  }, [companyDocs, companyQuery]);

  const filteredPrivateDocKeys = useMemo(() => {
    const query = normalized(privateQuery);
    return privateDocKeys.filter((doc) => matchesSearch(doc, query));
  }, [privateDocKeys, privateQuery]);

  function updateSelection(
    setSelection: (value: Set<string>) => void,
    previous: Set<string>,
    key: string,
    checked: boolean,
  ) {
    const next = new Set(previous);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setSelection(next);
  }

  return (
    <section className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">
          Searchable knowledge
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose the searchable sources for this template. Published knowledge
          versions are embedded, and runtime search is still hard-scoped to the
          active binding before results are returned.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)_minmax(260px,0.75fr)]">
        <div className="space-y-3">
          {companyMode === "selected"
            ? Array.from(selectedCompanyKeys).map((docKey) => (
                <input
                  key={docKey}
                  type="hidden"
                  name="commonKnowledgeDocKey"
                  value={docKey}
                />
              ))
            : null}

          <FormRow
            label="Company knowledge base"
            htmlFor="commonKnowledgeMode"
            hint="Ready means the published version has completed indexing."
          >
            <Select
              id="commonKnowledgeMode"
              name="commonKnowledgeMode"
              value={companyMode}
              onChange={(event) =>
                setCompanyMode(event.target.value as KnowledgeMode)
              }
            >
              <option value="all">All company documents</option>
              <option value="selected">Selected company documents</option>
              <option value="none">No company knowledge</option>
            </Select>
          </FormRow>

          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={companyQuery}
              onChange={(event) => setCompanyQuery(event.target.value)}
              className="pl-9"
              placeholder="Find company document"
              aria-label="Find company document"
            />
          </div>

          <KnowledgeListShell emptyLabel="No company knowledge documents match.">
            {filteredCompanyDocs.length ? (
              filteredCompanyDocs.map((doc) => {
                const checked =
                  companyMode === "all" ||
                  (companyMode === "selected" &&
                    selectedCompanyKeys.has(doc.docKey));

                return (
                  <label
                    key={doc.id}
                    className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={companyMode !== "selected"}
                      onChange={(event) =>
                        updateSelection(
                          setSelectedCompanyKeys,
                          selectedCompanyKeys,
                          doc.docKey,
                          event.target.checked,
                        )
                      }
                      aria-label={`Allow ${doc.title}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {doc.title}
                        </span>
                        <StatusBadge status={doc.status} />
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {doc.docKey}
                      </span>
                    </span>
                  </label>
                );
              })
            ) : null}
          </KnowledgeListShell>
        </div>

        <div className="space-y-3">
          {privateMode === "selected"
            ? Array.from(selectedPrivateKeys).map((docKey) => (
                <input
                  key={docKey}
                  type="hidden"
                  name="groupKnowledgeDocKey"
                  value={docKey}
                />
              ))
            : null}

          <FormRow
            label="Bound group/customer knowledge base"
            htmlFor="groupKnowledgeMode"
            hint="Selections are doc_key allowlists. Runtime still resolves the concrete group, customer, and personal rows from the active binding."
          >
            <Select
              id="groupKnowledgeMode"
              name="groupKnowledgeMode"
              value={privateMode}
              onChange={(event) =>
                setPrivateMode(event.target.value as KnowledgeMode)
              }
            >
              <option value="all">All bound private documents</option>
              <option value="selected">Selected private document keys</option>
              <option value="none">No bound private documents</option>
            </Select>
          </FormRow>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={privateQuery}
                onChange={(event) => setPrivateQuery(event.target.value)}
                className="pl-9"
                placeholder="Find private key"
                aria-label="Find private document key"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={privateMode !== "selected"}
              onClick={() =>
                setSelectedPrivateKeys(
                  new Set(filteredPrivateDocKeys.map((doc) => doc.docKey)),
                )
              }
            >
              <SquareCheckBig />
              Visible
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={privateMode !== "selected"}
              onClick={() => setSelectedPrivateKeys(new Set())}
            >
              <SquareMinus />
              Clear
            </Button>
          </div>

          <KnowledgeListShell emptyLabel="No private knowledge keys match.">
            {filteredPrivateDocKeys.length ? (
              filteredPrivateDocKeys.map((doc) => {
                const checked =
                  privateMode === "all" ||
                  (privateMode === "selected" &&
                    selectedPrivateKeys.has(doc.docKey));

                return (
                  <label
                    key={doc.docKey}
                    className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={privateMode !== "selected"}
                      onChange={(event) =>
                        updateSelection(
                          setSelectedPrivateKeys,
                          selectedPrivateKeys,
                          doc.docKey,
                          event.target.checked,
                        )
                      }
                      aria-label={`Allow ${doc.title}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {doc.title}
                        </span>
                        {doc.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {scope}
                          </Badge>
                        ))}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {doc.docKey}
                      </span>
                      {countLabel(doc) ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {countLabel(doc)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            ) : null}
          </KnowledgeListShell>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <Checkbox
                name="includeChatHistorySearch"
                defaultChecked={defaultIncludeChatHistorySearch}
                aria-label="Allow vector search over bound chat history"
              />
              <span className="space-y-1">
                <span className="block font-medium">
                  Bound chat history search
                </span>
                <span className="block text-muted-foreground">
                  Allow the agent to search this group&apos;s indexed messages,
                  links, media transcripts, and extracted media descriptions.
                </span>
              </span>
            </label>
          </div>

          <p className="rounded-md border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
            The search endpoint derives the binding, template version, and
            provider group from deterministic IDs. A bound agent can only search
            the WhatsApp group attached to its own binding.
          </p>
        </div>
      </div>
    </section>
  );
}

function KnowledgeListShell({
  children,
  emptyLabel,
}: {
  children: ReactNode;
  emptyLabel: string;
}) {
  return (
    <div className="max-h-[360px] overflow-auto rounded-md border border-border bg-background">
      {children ? (
        children
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}
