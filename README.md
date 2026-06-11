# huji

A minimalist in-browser markdown editor.

From Korean `휴지` (hyuji) — scrap paper. The idea is to write like you would on a scrap: quickly, without ceremony.

## Purpose

One place to dump text. Load a large markdown file, split it into sections, edit section by section. No account, no server, no sync. Everything stays in your browser (IndexedDB).

## Features

- Section-based editing — split a large markdown file by headings, edit one section at a time
- Frontmatter support (JSON / YAML)
- Find and replace across all sections
- Section reorder
- Preview (markdown rendered)
- Import / export as `.md`
- Dark mode

## Non-goals

- Cloud sync or collaboration
- Rich text / WYSIWYG
- Plugin ecosystem
- Mobile-first UX

## Build

```sh
deno run dev      # development server (http://localhost:5173)
deno run build    # production build → dist/
```

Or with npm/pnpm:

```sh
npm install
npm run dev
npm run build
```
