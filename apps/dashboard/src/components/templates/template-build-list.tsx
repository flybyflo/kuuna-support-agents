"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { SimpleTable } from "@/components/data-table/simple-table";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import type { TemplateBuild } from "@/lib/api-client/types";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

function formatBuildOutput(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function TemplateBuildList({ builds }: { builds: TemplateBuild[] }) {
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const selectedBuild = useMemo(
    () => builds.find((build) => build.id === selectedBuildId && build.logsRef),
    [builds, selectedBuildId],
  );

  return (
    <>
      <SimpleTable
        data={builds}
        emptyMessage="Noch keine Builds für diese Version."
        columns={[
          {
            header: "Build",
            cell: (build) => (
              <code className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {build.id}
              </code>
            ),
          },
          {
            header: "Status",
            cell: (build) => <StatusBadge status={build.status} />,
          },
          {
            header: "Image",
            cell: (build) => (
              <div className="space-y-1">
                {build.imageRef ? (
                  <p className="font-mono text-[11px] text-foreground">{build.imageRef}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">n/a</p>
                )}
                {build.imageTag ? (
                  <p className="font-mono text-[11px] text-muted-foreground">{build.imageTag}</p>
                ) : null}
              </div>
            ),
          },
          {
            header: "Output",
            cell: (build) =>
              build.logsRef ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setSelectedBuildId(build.id)}
                >
                  View output
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">n/a</span>
              ),
          },
          {
            header: "Updated",
            cell: (build) => (
              <span className="text-xs text-muted-foreground">{formatDateTime(build.updatedAt)}</span>
            ),
          },
        ]}
      />

      <DialogPrimitive.Root
        open={Boolean(selectedBuild)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedBuildId(null);
          }
        }}
      >
        {selectedBuild ? (
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              className={cn(
                "fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              )}
            >
              <div className="border-b border-border px-5 py-4 pr-12">
                <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                  Build output
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono text-xs">{selectedBuild.id}</span>
                  <span className="mx-2">·</span>
                  {selectedBuild.status}
                  <span className="mx-2">·</span>
                  {formatDateTime(selectedBuild.updatedAt)}
                </DialogPrimitive.Description>
              </div>

              <pre className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 font-mono text-xs leading-relaxed text-foreground">
                {formatBuildOutput(selectedBuild.logsRef ?? "")}
              </pre>

              <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden">
                <XIcon className="size-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </DialogPrimitive.Root>
    </>
  );
}
