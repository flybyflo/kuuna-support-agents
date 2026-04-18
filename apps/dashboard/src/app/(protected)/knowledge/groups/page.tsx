import Link from "next/link";
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
    <div className="grid">
      <PageHeader
        title="Group Knowledge"
        description="Manage group-specific knowledge sets that override common scope during retrieval."
      />

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {scopedBindings.map((binding) => {
          const groupDocCount = docs.filter(
            (doc) => doc.providerGroupId === binding.providerGroupId,
          ).length;

          return (
            <article key={binding.id} className="panel stack">
              <h2>{binding.groupTitle}</h2>
              <p className="muted-text">
                Group ID: <span className="inline-code">{binding.providerGroupId}</span>
              </p>
              <p className="muted-text">Knowledge docs: {groupDocCount}</p>
              <Link href={`/knowledge/groups/${binding.providerGroupId}`} className="button">
                Open knowledge
              </Link>
            </article>
          );
        })}
      </section>
    </div>
  );
}
