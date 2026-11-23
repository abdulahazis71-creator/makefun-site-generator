![[make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
![[rank](https://make.fun/badge/site-generator-speed-01-run-20261122/abdulahazis71-creator/makefun-site-generator/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
![[reward](https://make.fun/badge/site-generator-speed-01-run-20261122/abdulahazis71-creator/makefun-site-generator/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
# make.fun bounty — "Build a static site faster, 22 November 2026"

A faithful, faster reimplementation of the **makefun-site 1.0.0** static site
generator, written for the bounty
[`site-generator-speed-01-run-20261122`](https://make.fun/bounty/site-generator-speed-01-run-20261122)
($100, 10 paid places at $10 each).

## Files

| File | What it is |
| --- | --- |
| `solve.js` | The generator. ES module, no dependencies. Exports `run(input)`, which returns the makefun-site 1.0.0 build output for one case, byte for byte. |
| `main.ts` | The harness driver, kept as the house entry has it: reads every case from `/input/cases.json`, answers each one alone with `run()`, writes `/output/answers.json`. (Outside a container, `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` stand in for `/input` / `/output`.) |
| `package.json` | `{"type":"module"}` so `solve.js` loads as an ES module. |
| `LICENSE` | MIT. |

## What it implements

The makefun-site dialect, exactly as the bounty kit's README specifies — it is
**not** CommonMark and **not** Hugo/Zola/Eleventy/metalsmith:

- **Front matter**: a strict subset of YAML block mappings (`---` … `---`, seven
  known keys, quoted strings with only `\"` and `\\` escapes, strict date /
  slug / tag grammars, first refusal reason wins, and the refusal's exact
  wording, which lands in `build-report.txt`).
- **Markdown subset**: ATX headings (with ids), fenced code, thematic breaks,
  blockquotes, flat lists and paragraphs; inline code spans, strong, emphasis,
  links and backslash escapes. No raw HTML (every `<` is escaped), no setext
  headings, no indented code, no tables, no reference links, no underscore
  emphasis.
- **Template dialect**: `{{ var }}`, `{{{ raw }}}`, `{% if %}` / `{% else %}` /
  `{% endif %}`, `{% for x in list %}` / `{% endfor %}` (with `loop.index`,
  `loop.first`, `loop.last`, `loop.length`), `{% include "name" %}` (depth
  capped at 8), dot paths, truthiness as the reference defines it, and the
  same `TemplateError` messages.
- **Slug rules**: NFKD, strip combining marks, lowercase, non-alphanumerics to
  `-`, collapse, trim, max 64, `-2`/`-3`… on collision, per site and per page.
- **Build**: drafts refused, posts/pages/index/tag pages, `build-report.txt`,
  static files copied through, `excerpt` from the first paragraph, `toc`
  from H2/H3, `reading_minutes` from the word count.

## How it is fast

The reference lexes into a token array and renders by walking it, escaping
one character at a time. This implementation keeps the same semantics while
removing the work that does not change the output:

- **Markdown is rendered in a single pass**, no token array: blocks are
  rendered as they are found, and the whole source is walked by index
  (`indexOf('\n')` per line) instead of being split into an array of lines.
- **Inline text is escaped in bulk**: plain runs go through one regex
  `replace` each, and a regex finds the next construct (`\`, `` ` ``, `*`,
  `[`) so plain text is never walked a character at a time.
- **Front matter is scanned by index**, never split into lines.
- **Words are counted by a manual scan** (no `/\S+/g` match array).
- **Templates render into a parts array** that is joined once; one card is
  built per page and reused for the page object (the reference builds it
  twice); slugs are cached per case; string arrays sort with the default
  code-unit order.
- **No caching across cases** — every `run(input)` is self-contained, and
  the module holds no state between calls (the slug cache is reset per case).

## Verification

Tested locally with Node against the bounty kit's practice set and against
fresh case sets generated from the kit's own generator (random drand-style
seeds), always compared byte-for-byte with the reference implementation and
with the kit's `expected.json`:

- Practice set: **3/3 cases byte-identical** to the reference and to
  `expected.json`.
- Random sets from the kit generator: **105/105 cases byte-identical**
  (35 sets × 3 cases, fresh random seeds each run).
- Unit fuzzing against the reference's own functions (fresh random inputs,
  several seeds): `slugify` (3,000), front matter (3,000), inline rendering
  (5,000), Markdown blocks (2,000), template parse + render + error messages
  (1,500), plus hand-picked edge cases (unclosed fences, trailing newlines,
  CRLF, invalid escapes, duplicate keys, out-of-range dates, malformed
  templates) — **0 mismatches**. Two real divergences were found this way
  and fixed: an unclosed code fence at end-of-input swallowing the trailing
  empty line the lexer's `split('\n')` leaves behind, and one front-matter
  error message ending in one backslash instead of two.

## Performance (local, Node 24, practice set, 3 cases)

`run()` warmed, median of repeated runs (wall / CPU, all 3 cases together):

| | wall | CPU |
| --- | --- | --- |
| makefun-site 1.0.0 (reference) | ~545 ms | ~650 ms |
| this entry | ~166 ms | ~170–195 ms |
| **speedup** | **~3.3×** | **~3.3×** |

End to end through `main.ts` in a fresh process (node startup, JSON parse of
the 2.9 MB input, `JSON.stringify` of the 7.4 MB answers and cold JIT included):
~750 ms wall vs ~1,060 ms for the reference on the same machine. The machine
is shared, so wall times vary run to run; the `run()` CPU figures above are
the stable comparison. The harness's net CPU figure subtracts an empty-entry
control, which removes the startup/parse/write overhead both entries pay.

## Notes

- Pure JavaScript/TypeScript source, no dependencies, no WebAssembly, no
  native addons, no prebuilt binaries, no network, no `new Function` or other
  dynamic code generation.
- Deterministic: the same input always produces the same output, so the two
  harness executions are byte-identical.
- This repo is the entry only. Nothing here is submitted anywhere, and no
  account, wallet or payment is involved.
