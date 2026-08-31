# Project Agent Guide

Conventions this codebase is held to. Read this before making changes.

> **Note on `_dev/`**
> The author keeps a private knowledge base at `_dev/` — working notes, decision
> records, and prompt transcripts. It is deliberately not published, so those
> paths are absent from a public clone. Sections below that reference `_dev/`
> apply only when working in the author's tree. Everything else applies always.

## Commands

```powershell
npm install
npm run dev         # Vite dev server
npm run build       # verifies vendored codec hashes, then builds to dist/
npm run preview     # serve the build on :4173

npm test            # 133 unit tests
npm run check       # tests + function checks + codec hash verification
npm run check-api   # 45 checks; calls the serverless handlers directly
npm run check-ui    # 180 checks; requires `npm run preview` running first
npm run sync-codec  # copy the codec in from its own tree and rewrite the manifest
```

Run `npm run check` before considering a change complete. `check-ui` needs a
preview server already listening, and drives an installed Edge or Chrome through
`playwright-core` — it does not download a browser.

## Invariants

These are not style preferences. Breaking one is a defect.

1. **An address must always mean the same picture.** The mapping from address to
   pixels is the product. If a change would make an existing address render
   differently, the URL version must be bumped, not quietly changed.
2. **Never hand-edit `src/vendor/codec/`.** It is a synchronised copy verified by
   a sha256 manifest; the build fails on drift. Edit the codec in its own tree
   and run `npm run sync-codec`.
3. **Every address is valid by construction.** There is no validation step and
   no "invalid address" state. Do not add one — fix the bijection instead.
4. **The serverless functions do not log.** `api/` exists only to answer
   link-preview crawlers. A test enforces the absence of logging. Visitors are
   not observed.
5. **Exports are lossless.** A file in someone's hand must not disagree with the
   address that produced it.
6. **Rendering stays client-side.** Pixels are computed in the browser, never
   fetched as images.

## Working rules

1. Preserve the project's core beliefs unless the user explicitly changes them.
2. Prefer current canonical documentation over historical discussion.
3. If code and documentation disagree, resolve the inconsistency rather than
   silently choosing one.
4. Use deterministic tooling for checks that can be automated. Do not rely on
   prose instructions where a test can enforce the rule.
5. Keep historical records. Do not rewrite old prompts, plans, or debug evidence
   to make history look cleaner.

## Language

- **Commit messages: English.** Title in the imperative, body explaining why.
- Source comments, UI copy, and the wiki: Korean.
- The UI ships five languages; changing user-facing copy means changing all of
  them, not just Korean.

## After substantial changes

- Update affected documentation.
- Record decisions whose reasoning would not be obvious from the code.
- In the author's tree: update `_dev/docs/current-state.md`, add new gotchas to
  `_dev/docs/gotchas.md`, and move finished plans from
  `_dev/docs/exec-plans/active/` to `completed/` rather than deleting them.
