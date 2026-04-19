import Link from "next/link";
import { ArrowRight, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listBindings, listKnowledgeDocs } from "@/lib/api-client";
import { requireSession, canAccessGroup } from "@/lib/auth/session";

export default async function GroupKnowledgeIndexPage() {
  const session = await requireSession();
  const [bindings, docs] = await Promise.all([
    listBindings(),
    listKnowledgeDocs("group"),
  ]);

  const scopedBindings = bindings.filter((binding) =>
    canAccessGroup(session, binding.providerGroupId),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Group knowledge"
        description="Manage group-specific knowledge sets that override common scope during retrieval."
      />

      {scopedBindings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FolderOpen
              aria-hidden
              className="mx-auto mb-3 size-8 text-muted-foreground"
            />
            <p className="text-sm text-muted-foreground">
              No accessible groups yet — bind a group to start managing its
              knowledge.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {scopedBindings.map((binding) => {
            const groupDocCount = docs.filter(
              (doc) => doc.providerGroupId === binding.providerGroupId,
            ).length;

            return (
              <Card key={binding.id}>
                <CardHeader>
                  <CardTitle>{binding.groupTitle}</CardTitle>
                  <CardDescription>
                    <code className="font-mono text-xs">
                      {binding.providerGroupId}
                    </code>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <p className="text-sm text-muted-foreground">
                    {groupDocCount} knowledge{" "}
                    {groupDocCount === 1 ? "doc" : "docs"} indexed.
                  </p>
                  <Button asChild className="w-full">
                    <Link
                      href={`/knowledge/groups/${binding.providerGroupId}`}
                    >
                      <span>Open knowledge</span>
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
