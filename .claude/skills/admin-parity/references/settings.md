# Settings: adding or changing a setting or a section

Settings are sections (`SettingsSection` in `packages/contracts/src/settings.ts`), each a strict
zod schema in `SECTION_SCHEMAS`, stored as one versioned record per section.

## Add a setting to an existing section

1. **Type and default.** Add the field to the interface it belongs to: `GameConfig`
   (game-core `config.ts`, plus `DEFAULT_GAME_CONFIG`), `BotConfig`
   (`apps/server/src/config/bot-config.ts`), `AppearanceSettings` or the camera settings. Add the
   default in `apps/server/src/settings/defaults.ts` if it is not derived.
2. **Schema with its words.** Add it to the section schema in contracts with
   `.meta(field('Title', 'What it does and its effect on play.', 'unit'))`. This one string is the
   admin panel's label and help **and** the description MCP clients see. Write it for both: say
   what the value does, not how the form looks. Cross-field rules go in a `.refine` on the
   section (same section) or in `SettingsService.checkAcrossSections` (across sections).
3. **Panel layout.** Add `{ key, kind, step?, group? }` to the section in
   `apps/web/src/admin/catalog.ts`. No label or help text there.
4. **Stored data.** A new field in an existing section needs a settings-file migration: bump
   `format` and migrate in `parseSettingsFile` (`json-file-settings-store.ts`), as format 2 → 3
   did for `maxSlopeDeg`. Seeding does not fill new fields in existing sections.
5. **Live effect.** `settingsChange` (`match-simulation/settings-change.ts`) must know whether the
   field restarts the match (rules, rooms, bots) or redraws (appearance, camera). If clients
   receive it, check `MatchSetup` and bump `PROTOCOL_VERSION` for a breaking socket change.
6. **MCP: nothing to add.** `update_<section>_settings` is generated from the schema, so the field
   and its description appear in the tool automatically. Check the tool description
   (`effectOf` in `settings.operations.ts`) still says the right thing about restart or redraw.

## Add a new section

Everything above, plus:
- add the name to `SettingsSection` and the schema to `SECTION_SCHEMAS`;
- add `SECTION_TEXT[section]` (title and summary: the panel heading and the MCP tool description);
- add a `LiveSettings` part and its `settingsChange` differ (it does not compile without one);
- add the section's layout to `catalog.ts`;
- add `update_<section>_settings` to the operation-name snapshot in `settings.operations.test.ts`.

A new section needs no migration: seeding fills a missing section with its defaults on the next
start.

## Do not

- Do not compute or validate a setting in the panel with code the server lacks. If the panel
  needs a derived value (a range from speed × lifetime), put the function in game-core and use
  it on both sides, as `playRulesOf` does.
- Do not add an env var for anything an admin should change. Env is deployment-only.

## Verify

Run the verification commands in `SKILL.md`. Then read the generated tool in an MCP client (or
`client.listTools()` in `mcp-admin.e2e.test.ts`) and check the field shows its title and
description.
