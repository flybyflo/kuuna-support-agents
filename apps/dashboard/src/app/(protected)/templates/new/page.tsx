import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { createTemplateAction } from "@/lib/templates/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = getSingleParam(params.error);

  return (
    <div className="grid">
      <PageHeader
        title="New template"
        description="Create a template first, then add/publish versions and bind a group."
        actions={
          <Link href="/templates" className="button button-secondary">
            Back to templates
          </Link>
        }
      />

      {error ? (
        <Notice title="Template creation failed" tone="warning">
          <p className="muted-text">{error}</p>
        </Notice>
      ) : null}

      <section className="panel">
        <h2>Template details</h2>
        <form action={createTemplateAction} className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Template key
            <input
              name="key"
              placeholder="support-default"
              required
              pattern="[a-zA-Z0-9._\-\s]+"
            />
          </label>

          <label>
            Display name
            <input name="displayName" placeholder="Support Assistant" required />
          </label>

          <button type="submit" className="button">
            Create template
          </button>
        </form>
      </section>
    </div>
  );
}
