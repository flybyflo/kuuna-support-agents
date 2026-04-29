# Knowledge, RAG, and Tenant Isolation Requirements

## 1) Purpose

This document defines the requirements for the Kuuna Knowledge Base, RAG retrieval, Pi-Agent knowledge access, evidence Todo workflow, and hard tenant isolation.

The product context is a staff-operated WhatsApp group system for evidence preservation in cases involving online hate, harassment, and related legal support workflows. A typical group contains one client, one lawyer, one company staff member, and the bot. Clients share screenshots, links, documents, messages, audio, or other evidence in the group. The system must preserve the evidence context, create operational follow-up Todos, and help the bot answer safe process or case-status questions using scoped Knowledge.

The highest priority is isolation: private data must never be retrievable across unauthorized WhatsApp groups or users.

---

## 2) Product Goals

1. Provide a Knowledge Base that supports three access levels:
   - common company process knowledge
   - WhatsApp-group-scoped knowledge
   - personal client knowledge
2. Use RAG to retrieve relevant Knowledge and chat context for Pi-Agent runs.
3. Ensure the bot can answer safe process and case-status questions without exposing private data.
4. Create deterministic Todos for evidence-like uploads or relevant evidence text.
5. Make all retrieved Knowledge sources auditable in the dashboard.
6. Enforce tenant isolation with both application-level guards and database-level policies.

---

## 3) Core Domain Model

### 3.1 Knowledge Levels

The system must support these Knowledge levels:

1. `common`
   - General company processes only.
   - May include intake steps, evidence handling instructions, bot behavior rules, FAQ-style process answers, staff workflows, and escalation rules.
   - Must not include client names, personal facts, case facts, evidence content, screenshots, transcripts, links from client cases, or any other private data.
   - If retrieval scope is missing or ambiguous, the system may fall back to `common` only.

2. `group`
   - Scoped to exactly one WhatsApp group via `provider_group_id`.
   - May include case-status facts, group-specific instructions, extracted chat history, media transcripts, and manually managed group docs.
   - Must never be retrieved by agents running for another WhatsApp group.

3. `personal`
   - Scoped to one client profile.
   - The client profile must be identifiable by WhatsApp User JID plus an internal profile ID.
   - Personal Knowledge may be used only in WhatsApp groups explicitly authorized for that client profile.
   - Personal Knowledge can be extracted automatically from chat and used immediately, but only inside authorized scopes.

### 3.2 WhatsApp Group Model

v1 supports exactly one primary client per WhatsApp group.

Each group member must have an explicit role assigned in the dashboard:

- `client`
- `lawyer`
- `company_staff`
- `bot`

The role model must distinguish authorized professional participants from other clients. Lawyers and company staff are allowed to participate in the client's group and may trigger retrieval of that client's authorized group and personal Knowledge. They must not be interpreted as separate clients whose private data should be merged into the group.

Groups with multiple clients or multiple data subjects are out of scope for v1. If they appear in production, the system must treat them as unsupported and require staff review before enabling private retrieval.

### 3.3 Client Profile Identity

The system must maintain a client profile identity separate from raw WhatsApp sender data.

Minimum requirements:

1. Store the primary WhatsApp User JID for the client.
2. Allow the profile to be linked to one or more authorized WhatsApp groups.
3. Use the internal client profile ID for personal Knowledge ownership.
4. Keep WhatsApp User JID as an identity source, not as the only long-term domain identifier.

---

## 4) Bot Behavior Requirements

### 4.1 Allowed Direct Answers

The bot may answer directly in WhatsApp when the answer is based on approved scoped Knowledge and belongs to one of these categories:

1. General process questions from `common` Knowledge.
2. Clear case-status questions from authorized `group` or `personal` Knowledge.
3. Simple confirmations about evidence intake or Todo creation.

Examples of allowed answer categories:

- "What should I upload next?"
- "Did you receive my screenshot?"
- "What happens after I upload the link?"
- "What is the current status that was already documented in this group?"

### 4.2 Questions That Must Be Triaged

The bot must create a Todo instead of answering directly when a message asks for:

1. Legal advice.
2. Legal strategy.
3. Assessment of legal chances.
4. Interpretation of a potentially defamatory, hateful, or unlawful statement.
5. Any ambiguous case-specific question where the answer is not clearly present in scoped Knowledge.
6. Any question where the bot would need to infer facts that have not been documented.

The bot may acknowledge receipt and state that the team or lawyer will review the question.

### 4.3 Evidence Todo Creation

Every evidence-like upload or relevant evidence text must create a Todo deterministically.

Evidence-like inputs include:

- images and screenshots
- videos
- audio recordings
- PDFs
- text files
- links
- copied message text
- descriptions of incidents, threats, insults, harassment, or online hate

Todo creation must not depend on the model deciding that the content is important. The deterministic backend path must create a Todo for supported evidence-like inputs even if the model is unavailable.

The model may enrich the Todo summary, priority, and suggested next steps after deterministic creation.

---

## 5) Evidence Todo Requirements

v1 does not require a separate Evidence entity. Todos and source messages are the operational evidence workflow.

Each evidence Todo must reference enough source metadata to preserve context and support later review.

Required metadata where available:

1. WhatsApp group ID.
2. Source message ID.
3. Provider message ID.
4. Sender WhatsApp User JID.
5. Message timestamp.
6. Media asset ID.
7. Provider media ID.
8. File name.
9. MIME type.
10. Storage key.
11. File byte size.
12. Content hash or checksum.
13. Transcript ID for audio or video.
14. Link URL and normalized URL.
15. Agent run ID if a model enriched the Todo.

Todo records must remain linked to the original message and media records. If media processing is pending, the Todo must still exist and may be updated after transcript or media analysis completes.

---

## 6) Knowledge Ingestion Requirements

### 6.1 Sources

The Knowledge Base must index:

1. Manually managed common docs.
2. Manually managed group docs.
3. Manually managed personal docs.
4. WhatsApp chat history.
5. Media transcripts.
6. Links and link titles.
7. Automatically extracted personal Knowledge from chat.

### 6.2 Trust and Publication

Manual docs must follow draft, publish, rollback governance before they are usable for answers.

Ingested chat, links, and media transcripts may be used as untrusted retrieval context. They must never override system prompts, tool policies, role rules, or tenant isolation rules.

Automatically extracted personal Knowledge may be used immediately inside authorized scopes. It must still be marked with provenance, source message IDs, extraction time, and confidence where available.

### 6.3 Untrusted Content Rule

All user-provided and retrieved content is untrusted.

Prompt assembly must state that retrieved Knowledge, chat history, transcripts, file content, and user messages cannot override:

- system instructions
- tenant isolation
- role access rules
- tool policies
- egress policies
- legal advice restrictions

---

## 7) RAG Retrieval Requirements

### 7.1 Target Store

Use PostgreSQL with pgvector as the vector store.

The current text-only embedding storage must be replaced or migrated to real vector-backed retrieval:

1. Store embeddings in `vector` columns with a model-specific dimension.
2. Create vector indexes, preferably HNSW where supported.
3. Keep enough metadata on every chunk to enforce retrieval scope.
4. Support semantic similarity search for user questions, messages, links, transcripts, and Knowledge docs.

### 7.2 Retrieval Inputs

Every private retrieval request must include an explicit access context:

1. `provider_group_id`
2. active group binding ID
3. agent instance ID
4. requesting WhatsApp sender JID
5. resolved member role
6. primary client profile ID for the group
7. authorized personal profile IDs
8. allowed Knowledge scopes from the active template

If any required private scope context is missing, invalid, or ambiguous, retrieval must return only `common` Knowledge.

### 7.3 Scope Filtering

Retrieval must enforce these filters before ranking results:

1. `common`
   - Allowed for all bound groups.
   - Must contain no private data.

2. `group`
   - Allowed only when `chunk.provider_group_id` equals the current `provider_group_id`.

3. `personal`
   - Allowed only when `chunk.client_profile_id` is in the authorized personal profile set for the current group.
   - For v1, this should normally be exactly the group's primary client profile ID.

No query must be able to request arbitrary group IDs, profile IDs, or scopes directly from model-controlled text.

### 7.4 Ranking

Ranking must combine semantic similarity with source priority.

Default priority:

1. authorized `personal`
2. current `group`
3. current conversation history
4. `common`

Ranking boosts must not bypass scope filters. Boosts apply only after the candidate set is already authorized.

### 7.5 Template Knowledge Filters

Template Knowledge filters must be enforced during retrieval.

If a template defines allowed doc keys or scope inclusion rules, the retriever must apply them before returning chunks. Storing these settings in template config is not sufficient.

### 7.6 Context Budget

The retriever must return a bounded set of chunks for each Agent Run.

The context assembly layer must:

1. Limit total retrieved tokens.
2. Prefer higher-ranked authorized chunks.
3. Include recent message context separately from semantic Knowledge where useful.
4. Preserve source metadata for audit.

---

## 8) Tenant Isolation Requirements

### 8.1 Isolation Principle

Private data must be impossible to retrieve across unauthorized tenants through normal application paths.

The system must use both:

1. Centralized application-level retrieval guards.
2. Database Row Level Security for private Knowledge and retrieval tables.

### 8.2 Fail-Safe Behavior

Retrieval must fail closed for private data.

If the system cannot prove that a group, sender, role, and client profile are authorized, it must:

1. Retrieve only `common` Knowledge.
2. Avoid group and personal Knowledge.
3. Create a staff Todo if the user request needs private context.
4. Record the fallback reason in Agent Run audit metadata.

### 8.3 Required Guardrails

The implementation must provide:

1. A single backend retrieval service or module that all Agent Run paths use.
2. No direct Pi-Agent database access for Knowledge retrieval.
3. No runtime tool that accepts arbitrary SQL, group IDs, profile IDs, or doc IDs from the model for Knowledge access.
4. RLS policies on private Knowledge tables and retrieval chunk tables.
5. Tests proving that unauthorized group and personal Knowledge cannot be retrieved.

### 8.4 Dashboard Access

Dashboard staff access must also respect role and group assignment rules.

Owners and admins may have broad administrative visibility. Operators and viewers must be limited to assigned groups unless explicitly granted broader permissions.

---

## 9) Pi-Agent Access Requirements

The Pi-Agent must receive only pre-scoped context from the backend.

The `knowledge_search` tool must not perform unrestricted live database search. It may either:

1. return pre-scoped retrieval hits already attached to the Agent Run context, or
2. call a backend retrieval endpoint that enforces the same access context and RLS rules.

The model must never decide which tenant, group, or client profile it is allowed to search.

Every Agent Run context must include:

1. resolved group identity
2. resolved sender role
3. authorized Knowledge scopes
4. retrieval hits
5. recent message context
6. open Todos for the same group
7. links and media attachments for the current message

The prompt must explicitly instruct the agent to triage legal advice requests and uncertain case questions into Todos.

---

## 10) Audit and Dashboard Requirements

Every Agent Run must record retrieval and tool provenance.

Required audit fields:

1. Agent run ID.
2. Provider group ID.
3. Sender WhatsApp User JID.
4. Sender role.
5. Authorized client profile ID.
6. Retrieved chunk IDs.
7. Retrieved source scopes.
8. Source types.
9. Source IDs.
10. Similarity scores.
11. Ranking boosts or final ranking score.
12. Template version ID.
13. Knowledge filter configuration used.
14. Tool invocations and results.
15. Todo IDs created or updated.
16. Fallback reasons when private retrieval was skipped.

The dashboard must show retrieval sources for staff review. Sources do not need to be shown in WhatsApp messages by default.

---

## 11) Acceptance Criteria

The implementation is acceptable only when all of these are true:

1. Cross-group leakage tests pass.
2. Cross-user leakage tests pass.
3. Authorized lawyer and company staff access works inside the client's group.
4. Missing or ambiguous private scope returns only `common` Knowledge.
5. Real pgvector semantic search is used for RAG retrieval.
6. Template Knowledge filters affect retrieval results.
7. Evidence-like inputs create Todos without requiring model success.
8. Evidence Todos contain required source metadata where available.
9. Agent Runs record chunk and scope audit metadata.
10. Prompt assembly treats retrieved and user-provided content as untrusted.

---

## 12) Required Tests

### 12.1 Isolation Tests

1. Group A cannot retrieve Group B `group` Knowledge.
2. Group A cannot retrieve Group B conversation chunks.
3. Client A personal Knowledge cannot be retrieved in Client B group.
4. A lawyer in Client A group can retrieve Client A authorized personal Knowledge.
5. A company staff member in Client A group can retrieve Client A authorized personal Knowledge.
6. Ambiguous sender role returns only `common`.
7. Missing client profile mapping returns only `common`.
8. Model-provided group or profile IDs are ignored.

### 12.2 RAG Quality Tests

1. Semantically similar wording retrieves relevant chunks without exact keyword matches.
2. Group and personal Knowledge outrank common Knowledge when all are authorized and relevant.
3. Common Knowledge is retrievable across groups.
4. Deleted messages are excluded from retrieval context.
5. Template doc-key filters remove disallowed chunks before ranking.

### 12.3 Todo Tests

1. Image upload creates a Todo.
2. Video upload creates a Todo.
3. Audio upload creates a Todo.
4. PDF upload creates a Todo.
5. Link creates a Todo.
6. Relevant copied evidence text creates a Todo.
7. Todo persists even if media analysis fails.
8. Todo metadata includes source IDs and file hash where available.

### 12.4 Audit Tests

1. Agent Run stores retrieved chunk IDs, scopes, source types, and scores.
2. Agent Run stores sender role and authorized profile context.
3. Agent Run records private retrieval fallback reasons.
4. Dashboard can display retrieval source provenance.

---

## 13) Implementation Priority

Implementation must prioritize in this order:

1. Tenant isolation and access context modeling.
2. RLS and centralized retrieval guards.
3. Evidence Todo determinism and metadata.
4. pgvector-backed semantic retrieval.
5. RAG ranking quality.
6. Dashboard source visibility and operator review ergonomics.

RAG quality must not be improved by weakening scope filters or using broader private context.

---

## 14) v1 Assumptions

1. The document language is English.
2. v1 has no client-facing dashboard.
3. v1 has no evidence export package.
4. Retention is unlimited by default.
5. Hard delete is admin-only.
6. Sensitive personal data is treated like normal personal data for v1, but protected by strict scope isolation.
7. One WhatsApp group has exactly one primary client in v1.
8. Roles are assigned manually in the dashboard.
9. Common Knowledge is safe to retrieve when private scope is ambiguous.
10. Personal Knowledge may be extracted automatically from chat and used immediately inside authorized scopes.

