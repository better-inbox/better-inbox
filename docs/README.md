# Docs

These pages are the docs at [byo.dev/docs/notifications](https://byo.dev/docs/notifications/quickstart). The site ([byo-oss/site](https://github.com/byo-oss/site)) reads every `.mdx` file in this folder from `main` when it builds, nightly and on each site deploy. This README isn't published.

Change the docs in the same PR as the code they describe.

## Pages

One file per page, served at `/docs/notifications/<file name>`. Frontmatter, all four keys required:

```yaml
---
title: Quickstart
description: One sentence for the page header and search results.
group: get started   # get started | guides | reference | operations
order: 2             # position within the group
---
```

The body starts with a short lead paragraph; the site renders the title. Use `##` and `###` for sections.

## Components

Available without importing:

- `<Callout kind="note">…</Callout>` (or `kind="warning"`)
- `<Steps>…</Steps>`: each step starts with a `###` heading
- `<Next>…</Next>`: anything merged to `main` but not yet on npm. The site labels it with `main`'s version and collapses it until the reader switches to the next version. After the release, remove the tags and move upgrade notes to `upgrading.mdx`.

Code fences take a file title: ```` ```ts title="lib/auth.ts" ````. Shell blocks use `sh`, without a `$` prompt.

Outside code, put `<`, `{` and `}` inside backticks: MDX treats them as markup. Link to other pages as `/docs/notifications/<file name>`.

## Preview

With byo-oss/site cloned next to this repo:

```sh
cd ../byo-site
BYO_DOCS_NOTIFICATIONS=../notifications pnpm dev
```
