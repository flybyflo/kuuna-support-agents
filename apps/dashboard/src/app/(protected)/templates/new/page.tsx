import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormActions, FormRow } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { createTemplateAction } from "@/lib/templates/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="New template"
        description="Create a template first, then add/publish versions and bind a group."
        actions={
          <Button variant="outline" asChild>
            <Link href="/templates">
              <ArrowLeft aria-hidden />
              <span>Back to templates</span>
            </Link>
          </Button>
        }
      />

      {error ? (
        <Notice title="Template creation failed" tone="warning">
          {error}
        </Notice>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Template details</CardTitle>
          <CardDescription>
            A stable key (used by the API) plus a friendly display name.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <form
            action={createTemplateAction}
            className="flex flex-col gap-4"
          >
            <FormRow
              label="Template key"
              htmlFor="key"
              hint="Lowercase, dashes or dots. Example: support-default."
            >
              <Input
                id="key"
                name="key"
                placeholder="support-default"
                required
                pattern="[a-zA-Z0-9._\-\s]+"
              />
            </FormRow>

            <FormRow label="Display name" htmlFor="displayName">
              <Input
                id="displayName"
                name="displayName"
                placeholder="Support Assistant"
                required
              />
            </FormRow>

            <FormActions>
              <Button type="submit">Create template</Button>
            </FormActions>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
