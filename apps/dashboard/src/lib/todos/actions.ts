"use server";

import { revalidatePath } from "next/cache";

import { requireAuthorized } from "@/lib/auth/guards";
import { createSessionBackendTrpcClient } from "@/lib/backend/client";

type TodoStatus = "open" | "in_progress" | "done" | "cancelled";

const TODO_STATUSES = new Set<TodoStatus>([
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

export async function updateTodoStatusAction(input: {
  todoId: string;
  status: TodoStatus;
}): Promise<void> {
  await requireAuthorized("todos", "write");

  if (!TODO_STATUSES.has(input.status)) {
    throw new Error("Invalid todo status.");
  }

  const client = await createSessionBackendTrpcClient();
  await client.agentState.updateTodoStatus.mutate(input);
  revalidatePath("/inbox", "layout");
}
