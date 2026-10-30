# Admin actions, new admin-managed entities and CMS content

## Add an admin action

1. **Operation.** Add it to the `@Operations()` provider of its domain module with
   `defineOperation`. Name it snake_case, verb first (`get_`, `list_`, `create_`, `update_`,
   `delete_`, `check_`). Give it a description written for a model: what it does, when to use
   it, what to pass, and what happens to live play. Give it a zod input schema with `.describe()`
   on fields that are not obvious. Writes set `access: 'write'`, take `expectedVersion`, and set
   `destructive: true` if they delete or irreversibly replace data. Add `summarize` if the full
   output is large.
2. **Rules where they belong.** Validation and cross-record rules go in the service
   (`SettingsService` and its successors), which throws `OperationError`. Shared computation goes
   in game-core. The operation only shapes input and calls them.
3. **REST, if the panel needs it.** Add an `AdminController` route that maps the request onto the
   operation's input and calls `this.runner.run(...)`. Nothing else. Keep the existing URL style
   and `AdminError` bodies (the filter does that).
4. **Panel.** Call the route from `apps/web/src/admin/api.ts`, and show refusals using the
   `AdminError` message and issues.
5. **MCP: nothing to add.** Every `@Operations()` operation is a tool automatically, hidden from
   read-only connections if it writes.
6. **Tests.** Add an operation test through `OperationRunner` (success, invalid, conflict,
   not_found, refused to a read actor), add the name to the snapshot in
   `settings.operations.test.ts` (or the domain's own snapshot), and add a REST test if you added
   a route.

An action only one surface can offer (undo history in the panel, live rooms only over MCP) is
fine. Say so in the operation's description or the panel, and in your summary to the user.

## Add a new admin-managed entity (and CMS content)

Treat it like settings and worlds (`CLAUDE.md`, "Design for the database"):
- a contracts schema (strict; never the answer key for questions);
- a store interface method with versioned records (`version`, `updatedAt`; writes name the version
  they replace);
- a service that validates, enforces cross-record rules and throws `OperationError`;
- operations for each action (list, get, create, update, delete, plus workflow steps such as
  `submit_for_review`, `publish_question` and `retire_question`), in a domain `@Operations()`
  provider;
- REST routes for the panel or CMS pages, each running an operation;
- the words: field `.meta()`/`.describe()` text in contracts, so CMS forms and MCP tools share it.

### CMS and the answer key

Question authoring needs the answer key, but play must never expose it:
- Authoring operations (`create_question`, `update_question`) take and return the full question,
  including `correctOptionId` and `explanation`. They are **write** access, so read-only MCP
  connections never see them. When roles arrive, restrict them to authors and reviewers.
- Read operations (`list_questions` and the like) return the prompt, options and metadata
  **without** the answer key, unless the actor may author.
- Nothing in `@volleyland/contracts` socket schemas gains answer fields. Admin schemas for authoring
  live apart from the socket messages.
- Add a test that every read operation's output for a question has no `correctOptionId` or
  `explanation`.

## Verify

Run the verification commands in `SKILL.md`. Then call the new operation once over REST and once
over MCP (`mcp-admin.e2e.test.ts` shows how) and check both get the same result and the same
refusal for the same bad input.
