import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_OPENAI_BASE_URL } from "../src/config.js";
import { getOpenAiModel } from "../src/model.js";
import { runAgent } from "../src/runner.js";
import { sanitizeAllowedTools } from "../src/tools.js";

test("sanitizes allowed tools without enabling Pi coding tools", () => {
  assert.deepEqual(
    sanitizeAllowedTools(["uppercase", "bash", "read", "todo_create", "write"]),
    ["uppercase", "todo_create"],
  );
});

test("uses gpt-5.5 and medium reasoning by default", async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await runAgent({
      user_prompt: "Please uppercase hello",
      allowed_tools: ["uppercase"],
    });

    assert.equal(result.success, true);
    assert.equal(result.model_used, "gpt-5.5");
    assert.equal(result.reasoning_effort, "medium");
    assert.equal(result.attempts[0]?.model, "gpt-5.5");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
});

test("applies OPENAI_BASE_URL to Pi OpenAI models", () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://openai-proxy:4000/v1/";
  try {
    const model = getOpenAiModel("gpt-5.5");

    assert.equal(model?.baseUrl, "http://openai-proxy:4000/v1");
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }
  }
});

test("uses the default OpenAI base URL when OPENAI_BASE_URL is blank", () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = " ";
  try {
    const model = getOpenAiModel("gpt-5.5");

    assert.equal(model?.baseUrl, DEFAULT_OPENAI_BASE_URL);
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }
  }
});

test("rejects runtime requests for another provider group", async () => {
  const previousProviderGroupId = process.env.KUUNA_PROVIDER_GROUP_ID;
  process.env.KUUNA_PROVIDER_GROUP_ID = "group-a@g.us";
  try {
    await assert.rejects(
      () =>
        runAgent({
          user_prompt: "hello",
          context: { provider_group_id: "group-b@g.us" },
        }),
      /runtime identity mismatch: provider_group_id/,
    );
  } finally {
    if (previousProviderGroupId === undefined) {
      delete process.env.KUUNA_PROVIDER_GROUP_ID;
    } else {
      process.env.KUUNA_PROVIDER_GROUP_ID = previousProviderGroupId;
    }
  }
});

test("accepts runtime requests matching container identity", async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousProviderGroupId = process.env.KUUNA_PROVIDER_GROUP_ID;
  const previousBindingId = process.env.KUUNA_BINDING_ID;
  const previousAgentInstanceId = process.env.KUUNA_AGENT_INSTANCE_ID;
  delete process.env.OPENAI_API_KEY;
  process.env.KUUNA_PROVIDER_GROUP_ID = "group-a@g.us";
  process.env.KUUNA_BINDING_ID = "binding-1";
  process.env.KUUNA_AGENT_INSTANCE_ID = "agent-1";
  try {
    const result = await runAgent({
      user_prompt: "hello",
      context: {
        provider_group_id: "group-a@g.us",
        binding_id: "binding-1",
        agent_instance_id: "agent-1",
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.model_used, "gpt-5.5");
  } finally {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (previousProviderGroupId === undefined) delete process.env.KUUNA_PROVIDER_GROUP_ID;
    else process.env.KUUNA_PROVIDER_GROUP_ID = previousProviderGroupId;
    if (previousBindingId === undefined) delete process.env.KUUNA_BINDING_ID;
    else process.env.KUUNA_BINDING_ID = previousBindingId;
    if (previousAgentInstanceId === undefined) delete process.env.KUUNA_AGENT_INSTANCE_ID;
    else process.env.KUUNA_AGENT_INSTANCE_ID = previousAgentInstanceId;
  }
});
