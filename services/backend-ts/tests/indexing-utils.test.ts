import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEmbeddingInput } from "../src/jobs/indexing-utils.js";

test("normalizeEmbeddingInput caps oversized embedding text", () => {
  const input = Array.from({ length: 7000 }, (_, index) => `word${index}`).join(" ");

  const normalized = normalizeEmbeddingInput(input);

  assert.ok(normalized.length <= 12000);
  assert.ok(normalized.split(/\s+/).length <= 6000);
  assert.match(normalized, /^word0\b/);
});

test("normalizeEmbeddingInput replaces empty text with sentinel", () => {
  assert.equal(normalizeEmbeddingInput(" \n\t "), "__empty__");
});
