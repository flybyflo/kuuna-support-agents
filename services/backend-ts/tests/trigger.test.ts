import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTrigger } from "../src/trigger.js";

test("mention trigger wins", () => {
  const decision = evaluateTrigger({
    message: {
      text: "@agent kuuna: hi",
      reply_to_provider_message_id: "msg-1",
      mentions: ["agent"],
    },
  });
  assert.equal(decision.shouldExecute, true);
  assert.equal(decision.triggerType, "mention");
  assert.equal(decision.reason, "agent_mention_present");
});

test("reply trigger is detected", () => {
  const decision = evaluateTrigger({
    message: {
      text: "plain",
      reply_to_provider_message_id: "msg-1",
      mentions: [],
    },
  });
  assert.equal(decision.shouldExecute, true);
  assert.equal(decision.triggerType, "reply");
});

test("prefix trigger handles leading whitespace", () => {
  const decision = evaluateTrigger({
    message: {
      text: "  /kuuna help",
      reply_to_provider_message_id: null,
      mentions: [],
    },
  });
  assert.equal(decision.shouldExecute, true);
  assert.equal(decision.triggerType, "prefix");
});

test("plain messages do not trigger", () => {
  const decision = evaluateTrigger({
    message: {
      text: "hello",
      reply_to_provider_message_id: null,
      mentions: [],
    },
  });
  assert.equal(decision.shouldExecute, false);
  assert.equal(decision.triggerType, null);
});
