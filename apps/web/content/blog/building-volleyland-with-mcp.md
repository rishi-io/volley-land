---
title: How I build Volleyland by talking to it
summary: The scenes, worlds, characters, courses and questions in my game, and how Claude builds each one over MCP.
order: 1
date:
draft: true
---

> **Outline.** Replace every ✍️ line with your own words, then delete this note.

✍️ Introduce yourself in two or three lines: your first name, that you're 15, and what got you into building games.

## What Volleyland is

✍️ Explain the game in your own words, as you'd tell a friend.

> **Facts.** Players run around an arena and throw things at each other. A hit freezes you until you answer a multiple-choice question. A wrong answer or running out of time costs health, and a right answer gives you a short shield. The server decides everything (who got hit, which question, whether you were right), so nobody can cheat from their browser.

✍️ Say what's different about how you build it: you don't only write code, you ask Claude to build things inside the running game.

## Connecting Claude to the game

✍️ Explain MCP to someone who has never heard of it. One comparison is enough: a list of things Claude is allowed to do in your app, with the rules for each.

> **Facts.**
> - `yarn dev` starts the game server on port 3001 and the website on 3000.
> - The repo's `.mcp.json` tells Claude Code where the server is: `http://localhost:3001/api/mcp`, named `volleyland`.
> - In Claude Code the tools show up as `mcp__volleyland__<name>`, for example `mcp__volleyland__list_worlds`. `get_server_info` is the first one to try.
> - Every button in the admin panel is also an MCP tool. The panel (REST at `/api/admin`) and Claude (MCP at `/api/mcp`) run the same code, so a rule the panel enforces is a rule Claude can't break either.
> - `MCP_ACCESS` decides what an MCP caller may do: `write` in development, `off` in production unless someone turns it on.

✍️ Paste what Claude answered when you first asked it what it can do in Volleyland.

## Worlds

✍️ Open with the world you built for this section: what you asked for, in the exact words you typed.

> **Facts.** A world is a floor (size, theme, terrain) with props on it (walls, trees, crates…), painted regions (paths, water), hills and spawn points. Themes: classic, park, schoolyard, beach, snow, library, space. Built-in worlds include Maple Park, Frost Fort, Grand Library, Orbital Station, Rolling Hills and Shipwreck Cove.
>
> The usual order:
> 1. `get_world_catalogue` and `get_settings` read the rules: what props exist, the limits and how far a throw goes (27 m by default).
> 2. `create_world` with `dryRun: true` tries a generated layout without saving, and Claude tries a few seeds and keeps the fairest.
> 3. `edit_world` changes it in batches: `add_prop`, `add_ring`, `add_region`, `add_hill`, `mirror`…
> 4. `check_world` plays referee. It flags a spawn point walled in, two spawns that can hit each other the moment they appear, no full cover, a world too crowded or too empty, or slopes too steep to climb.
> 5. `update_rooms_settings` with `worldId` puts rooms in the world. Open rooms start a new match, and players are told what changed.

```json
{ "start": { "from": "generate", "theme": "snow", "width": 40, "depth": 40,
             "density": 0.5, "symmetry": "mirror-z", "spawns": 6, "seed": 3 },
  "dryRun": true }
```

✍️ Replace this with the call Claude actually made for your world. What did `check_world` complain about the first time, and how did you fix it? Add a screenshot of the world in the game.

## Scenes

> **Pick your angle first.** "Scene" can mean two things in this repo, and only one of them is over MCP today:
> - **The camera,** which is over MCP: first or third person, whether players can switch, and how wide the view is.
> - **Scripted shots,** which are not over MCP: the "director" camera in `apps/web/src/game-client/runtime.ts` that films footage, for development only.
>
> Making camera shots an MCP tool could be your next feature, and its own post.

✍️ Explain how a world (just numbers) turns into what you see.

> **Facts.** The web app draws with React Three Fiber (React for three.js). `WorldScene.tsx` draws the floor, terrain, props and decor from the world's layout. The server never draws anything. It only sends where things are.
>
> `update_camera_settings` takes `expectedVersion` (from `get_settings`) and `changes`:
> - `defaultView`: `third-person` or `first-person`
> - `playerChoice`: whether players can switch with V
> - `firstPersonFov`: 50–110°

```json
{ "expectedVersion": 4, "changes": { "defaultView": "first-person", "firstPersonFov": 85 } }
```

✍️ Your actual call, and what changed on screen.

## Characters

✍️ Describe the characters as a player sees them, and the look you were going for.

> **Facts.** `update_appearance_settings` controls:
> - `palette`: 4–12 player colours
> - `accessories`: caps, beanies, crowns, so players differ by shape and not only by colour
> - `botMarker`: a visor and antenna on bots
> - `nameTags`
> - `healthBars`: off, opponents or everyone
> - `blobShadows`
> - `animation`: 0–1, run bounce, lean, throw and hit reactions. Players whose device asks for reduced motion always get 0.
>
> Bots fill empty seats and give them up when a person joins. Their normal throws aim at where you were, not where you're going. After a few misses a bot stands still, says a warning line and then throws one that leads you. The `bots` settings section tunes them, and it is never sent to players' browsers.

```json
{ "expectedVersion": 2, "changes": { "palette": ["#e63946", "#2a9d8f", "#ffb703", "#8338ec"], "accessories": true } }
```

✍️ Why do characters need to differ by shape too, not only colour? Why did you make the bots beatable on purpose?

## Courses

✍️ Why does a learning game need courses at all? Start from your own classes.

> **Facts.** The question bank is a tree:
>
> ```
> country (in, gb) → curriculum (in-cbse, gb-gcse) → level (in-cbse-class-10) → topic
>                                                     subject (mathematics, physics) ┘
> ```
>
> A topic joins a level to a subject, and subjects are shared between countries. It ships with CBSE Class 10 and GCSE Year 11.
>
> Start with `get_question_bank_overview`, the map of what's there and where the gaps are. Then create records in order, because each one points at the one before: `create_country`, `create_curriculum`, `create_level`, `create_subject` (or reuse one), `create_topic`. IDs are permanent lowercase slugs, such as `in-cbse-class-9`.
>
> A world can ask from its own pool (Frost Fort asks GCSE Year 11 chemistry and physics, Maple Park asks CBSE), set with `update_world`. Otherwise rooms use the room-wide pool. `preview_question_pool` says how many published questions match before you save.

✍️ Ask Claude to add a course you actually take (for example "CBSE Class 9 maths") and show what it did.

## Questionnaires

✍️ Pick a chapter you studied this term. Explain why a question in a game isn't like one in an exam: you're frozen and you have about ten seconds.

> **Facts.** What makes a good game question:
> - a short prompt (under ~200 characters) with no diagram
> - four options under ~60 characters each, exactly one right
> - wrong options are common mistakes, never jokes
> - no "all of the above"
> - plain symbols like × ² √ π, no LaTeX
> - an explanation under 300 characters, shown after you answer
>
> From a chapter to the game:
> 1. Record where the questions come from: `create_source` with the licence. Textbooks and exam papers are usually all-rights-reserved, so Claude writes new questions that test the same thing (`use: "aligned"`) instead of copying.
> 2. Run `import_questions` with `dryRun: true` first. It lists every problem by position, and the real import is all or nothing. New questions start as drafts.
> 3. Every answer is re-solved before publishing. For ten or more questions, a second Claude that isn't told the answers are right checks them. In this repo's seed, that pass caught giveaway options, a copied textbook example and a law that had changed since the textbook.
> 4. `update_question` with `status: "published"` puts it live, and a room asks it from the very next hit. The answer key goes only to the player who answered, and only after they answer.

✍️ Show one question you liked and one you rejected, and say why. Did a check catch a wrong answer key? End with what it felt like to get hit by your own question.
