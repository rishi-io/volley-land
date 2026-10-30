---
name: question-bank
description: Manage the Volleyland question bank CMS through the Volleyland admin MCP tools — countries, curricula, classes/years, subjects, topics, sources and multiple-choice questions (create, edit, import, fact-check, publish, retire) and which questions rooms ask. Use this whenever someone wants to add or fix questions, add a new curriculum, class, year or subject (e.g. CBSE Class 9, GCSE Year 10, Common Core Grade 8), turn a past paper, textbook chapter, PDF or worksheet into game questions, find gaps in coverage, review answer keys, or change what the game asks (e.g. "only Year 11 physics") — even if they don't say "CMS" or "question bank". Prefer this over editing data/questions.json or the seed JSON by hand.
---

# Question bank CMS (over MCP)

The question bank is admin-managed data behind the `volleyland` MCP server (`.mcp.json`, `http://localhost:3001/api/mcp`). The admin panel's Question bank pages run the same operations, so what you do here is exactly what an editor could do there. Tools appear as `mcp__volleyland__<operation>`; this skill names them by operation.

## Before you start

- **The server must be running** (`yarn dev`, or a deployed server with `MCP_ACCESS=write`). If the tools are missing, say so and ask the user to start it or approve the MCP server. Don't edit `apps/server/data/questions.json` or the seed files under `apps/server/src/content-workflow/seed/` instead. The running server holds its own copy, and changes to the seed reach only fresh installs. They are a code change for a developer, not CMS work.
- **Answer keys** (`correctOptionId`, `explanation`) appear only on a write-access connection. A read-only connection can browse but not author. Keep answer keys out of anything students will see.
- **Publishing is live.** Rooms ask published questions from the very next hit. New questions start as drafts, so check them before you publish.

## How the bank is organised

```
country (in, gb)  →  curriculum (in-cbse, gb-gcse)  →  level (in-cbse-class-10, gb-gcse-year-11)  →  topic
                                                                       subject (mathematics, physics…) ┘
source (textbook / specification / past paper / bank, with licence)  ←  question  →  topic
```

- A **topic** joins a level to a **subject**. Subjects are shared across countries; reuse an existing subject before you make a new one.
- A **question** belongs to one topic. It has a difficulty from 1 to 5 (relative to its level), a status (`draft`, `published` or `retired`), 2–6 options (a, b, c…), an answer key with an explanation, and an attribution: `source: { sourceId, use, reference }`.
  - `use`: `copied` (word for word), `adapted` (changed from a question in the source) or `aligned` (written new to match the source).
  - `reference`: where in the source the question comes from, e.g. "Paper 1H, Q7" or "Chapter 4, Exercise 4.2".
- **IDs** are permanent lowercase slugs. Follow the existing pattern:
  - levels: `<country>-<curriculum>-class-10`
  - topics: `in-cbse-10-math-quadratic-equations`
  - questions: `q-in-cbse-10-math-019`

  Read the neighbours first so new IDs continue the sequence.
- Records refer to each other. Create them in dependency order (country → curriculum → level; subject; topic; source; then questions). A delete is refused while anything still refers to the record, and the server keeps at least one question published.
- Every write takes the `expectedVersion` you last read. If it reports a conflict, read the record again and redo the change.

Start every session with `get_question_bank_overview`. It lists the countries, curricula, subjects and levels, with topic and question counts (draft, published, retired) per subject: your map and your gap report. Use `list_<kind>` (filtered by parent) and `list_questions` (filters: country, curriculum, level, subject, topic, source, status and `text`) for detail, and `get_question` for one question and where it sits.

## Adding questions from a source

This is the most common job: someone hands you a past paper, a textbook chapter, a worksheet or a URL.

1. **Record the source first** (`create_source`, or reuse one from `list_sources`): title, publisher, link, year, and the **licence**. If the user didn't say what the licence is, ask, or look it up on the publisher's site. Don't guess.
2. **Decide whether you may copy.** Copy text word for word (`use: "copied"`), or adapt it closely (`use: "adapted"`), only when the licence allows reuse. Examples: an open licence such as CC BY, the user's own or their school's material, or written permission the user tells you about. Exam-board papers, NCERT and other textbooks, and commercial question banks are normally all-rights-reserved. For those, write **original** questions that test the same content (`use: "aligned"`), and tell the user that's what you did and why. Note the licence decision in the source's `notes`.
3. **Place each question in a topic** (create missing topics under the right level and subject).
4. **Write or transcribe** to the standards below, then **check every answer** (see Accuracy).
5. **Save as drafts.** Use `create_question` for a few, or `import_questions` for a batch: send it first with `dryRun: true`, fix every issue it lists by position, then import for real. The import is all or nothing.
6. **Publish after the check**: `update_question { changes: { status: "published" } }`, or import the batch with `status: "published"` once it has been checked. Report what you added: counts by topic, the source, copy or aligned, and anything you were unsure of.

## Writing good game questions

A hit player is frozen and has about 10 seconds to answer, often on a phone or a classroom screen. So:

- **Short and unambiguous**: a prompt under ~200 characters, answerable in the head, with no diagram needed. If a question needs a figure, describe the situation in words or skip it.
- **Four options** by default, each under ~60 characters, exactly one correct. Make distractors common mistakes (the answer with a sign error, the cos instead of the sin, the confused term), never jokes.
- **No giveaways.** Options are shuffled, so never write "all of the above" or "none of the above". Don't make the right option the only long one, the only one that gives a reason, or the only one that echoes a word from the prompt. Keep options parallel in form.
- **Plain Unicode**, no LaTeX or Markdown: × ÷ − ² ³ √ π ° ≤ ≥ ⁿ, subscripts like CO₂.
- **Use the curriculum's own conventions**: British spelling and SI units for GCSE, NCERT terms for CBSE, the textbook's version of facts for textbook-specific content.
- **Explanation** (≤ 300 characters): why the right answer is right, and if it fits, why the tempting wrong one is wrong. Players see it after they answer.
- **Difficulty** relative to the level: 1 is something most students in the class get, 5 is the hardest exam-style item. Spread a topic across the range.
- **Time-sensitive facts** (laws, records, statistics): either frame them in time ("As the textbook describes…", "In 2024…") or check they are still true today.

## Accuracy

A wrong answer key in a classroom game teaches the wrong thing, so check before you publish:

- **Re-solve every question from scratch** before looking at the key. Confirm the key, confirm no other option is also defensibly correct, and confirm the explanation agrees.
- **For a batch (about 10 or more)**, also have an independent solver check it: a subagent given the questions *without* being told the answers are right, asked to report problems only. In this repo's seed, that second pass caught giveaway options, copied textbook examples and a law that had changed since the textbook. Apply its fixes, or reject them with a reason.
- Fixing a published question: `update_question`. To stop asking one, set `status: "retired"` (kept for the record). Delete only drafts or mistakes.

## Choosing what rooms ask

A pool is `curriculumIds` (question banks such as `in-cbse`, `gb-gcse`), `levelIds`, `subjectIds` (each empty for all; a question must match every non-empty list) and `difficulty: [min, max]`. There are two places for one:

- **A world's own pool** (`questions` on the world). Matches in that world ask from it. Every built-in world but the prototype court has one, e.g. Maple Park asks CBSE, Frost Fort GCSE Year 11 chemistry and physics. `list_worlds` shows each world's pool (`"room"` when it has none).
- **The room-wide pool** (the `questions` settings section), for worlds without their own.

1. `preview_question_pool { curriculumIds, levelIds, subjectIds, difficulty }` reports how many published questions match, and why a pool can't be used.
2. Save it:
   - for one world: `update_world { id, expectedVersion: <world version>, questions: {...} }` (`questions: null` hands the world back to the room-wide pool);
   - room-wide: `update_questions_settings { expectedVersion: <questions version from get_settings>, changes: {...} }`. It changes nothing in rooms whose world has its own pool.

   Open rooms the change applies to start a new match at once (players are told), so on a server people are using, ask before you change it.

A player isn't asked the same question twice while they stay in the room (even across new matches) until they've seen the whole pool. A pool needs enough questions for that: twenty or more is comfortable; under ten will repeat quickly.

## Adding a new curriculum or class

Example: "add CBSE Class 9 maths".

1. Read the overview. The country (`in`) and curriculum (`in-cbse`) exist, so check whether the level does.
2. `create_level { id: "in-cbse-class-9", curriculumId: "in-cbse", name: "Class 9", order: 9, ages: [14, 15], description }`.
3. Create a topic per chapter, using the current syllabus (look it up rather than recalling it, since syllabi are revised): `create_topic { id: "in-cbse-9-math-number-systems", levelId, subjectId: "mathematics", name, description }`.
4. Create the source records for the textbooks or specification, with links and licences.
5. Add questions as above. Report the new level's coverage with `get_question_bank_overview`.

## When something is refused

Refusals come back as tool errors with a message and issues by path, for example `options.2.text`, `source.sourceId: no source "x"`, or "still used by 3 topics". They are the same rules the panel enforces. Fix the input and retry rather than working around them.
