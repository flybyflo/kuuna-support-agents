import Link from "next/link";
import { Inbox, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function InboxIndexPage() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <Inbox className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Select a group
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick a WhatsApp group on the left to inspect its conversation,
            todos, binding, and lifecycle activity in one place.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/inbox/create">
            <Plug aria-hidden />
            <span>New WhatsApp group</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
