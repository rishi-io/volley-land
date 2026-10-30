# Rishi's blog

Your blog lives at `/blog` in the Volleyland web app. Each post is one Markdown file in this folder. The first is `building-volleyland-with-mcp.md`: scenes, worlds, characters, courses and questions in one post.

## Writing a post

1. Run `yarn dev` and open <http://localhost:3000/blog>. Drafts show there with a yellow DRAFT tag.
2. Open the post's file here. It starts as an outline:
   - Lines starting with **✍️** are prompts. Replace each one with your own words.
   - **Facts** boxes say what the code does today, taken from the repo. Keep them, change them or cut them. If the code changed, trust the code.
   - Try every MCP call in the post yourself before you publish, and paste what actually came back.
3. When it reads the way you want, delete the outline note at the top, set `date:` and change `draft: true` to `draft: false`.

Only posts with `draft: false` appear in a production build.

## The header

```
---
title: The post's title
summary: One sentence for the list on /blog
order: 3
date: 2026-11-02
draft: true
---
```

`order` sets the post's place in the list on `/blog`. The file name gives the address: `building-volleyland-with-mcp.md` is `/blog/building-volleyland-with-mcp`.

## About you

The blog says "Rishi, 15" and nothing else about you: no surname, school, photo or where you live. The name line is `BLOG` in `apps/web/src/blog/posts.ts`. Change the blog's title there too if you want a different one.
