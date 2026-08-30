# Museum of Babel

Every possible picture already hangs here. You only need the address.

An infinite gallery where **no image is ever stored**. A coordinate is decomposed
in mixed radix, and the resulting fields *are* the picture. The same address
always yields the same artwork, every address is valid, and the pixels are
computed in your browser.

```text
?a=C<base62>
   ↓  parse       address string → { floor, locality, x, y }
   ↓  codec       coordinate → codeword   (mixed radix, bijective)
   ↓  codec       codeword → fields       (quantizer, prediction mode, DCT basis, …)
   ↓  rooms       coordinate → room       (which style reads those fields)
   ↓  worker      fields + room → 256×256 pixels
   ↓  canvas      tiles laid out on an infinite grid
```

## The building

```text
floor 0    lobby. no artworks. a 64×64 grid that wraps, so walking returns you
floor 1    4×4 zones of 64px      address up to 74 chars
floor 2    8×8 zones of 32px                    275
floor 3    16×16 zones of 16px                1,081
floor 4    32×32 zones of 8px                 4,306
```

Each floor is a separate address space, and deeper floors show fewer works at
once because they cost more to draw. There is no fifth floor: an 8×8 basis cannot
scale into a block smaller than 8 pixels, so the tier list ends at 32.

Every floor is divided into **exhibition rooms** — irregular Voronoi districts,
roughly 160 cells across, each of which reads the same address bits a different
way. One room keeps only the diagonal predictors, another flattens every block
into a single colour, another derives colour from brightness like a two-ink
print. The room costs nothing to store because it is derived from the coordinate
itself, which also means you walk into a room rather than selecting one.

- Demo of the previous iteration: <https://demo-museumofbabel.vercel.app>
- Wiki explaining the concepts: <https://wiki-museumofbabel.vercel.app>

## What makes it unusual

- **Validity by construction.** There is no validation step. A malformed address
  cannot exist, so no "invalid address" screen exists either.
- **Locality is a goal, not an accident.** Neighbouring coordinates produce
  visually related artworks, which is what makes wandering feel like a gallery
  rather than a random-image viewer.
- **The address defines the pixels.** Exports are lossless PNG for that reason —
  a file in your hand must not disagree with the address that produced it.
- **Visitors are not logged.** Every pixel a person sees is computed
  client-side. The two serverless functions exist only to answer link-preview
  crawlers, and they contain no logging at all (enforced by a test).
- **The address cannot be compressed.** Every bit pattern is a valid picture, so
  the address space is used exactly to capacity and holds no redundancy — a
  compressor would make it longer on average. The only lever is bits per
  character, which is why the address is base62 and carries no readable prefix:
  the floor and the locality level are folded into its lowest six bits, behind a
  single leading character that marks the format version.

## Running it

```powershell
npm install
npm run dev        # Vite dev server
npm run build      # verifies the vendored codec hashes, then builds to dist/
npm run preview    # serve the build on :4173
```

### Checks

```powershell
npm test           # 97 unit tests
npm run check      # tests + function checks + codec hash verification
npm run check-api  # 45 checks; calls the serverless handlers directly
npm run check-ui   # 143 checks; needs `npm run preview` running first
```

`npm run check-ui` drives an already-installed Edge or Chrome through
`playwright-core`, so no browser download is required.

## Layout

```text
index.html          single page
src/                UI, camera, workers, i18n, styles
src/vendor/codec/   vendored copy of the codec, verified by sha256 manifest
api/                two Vercel functions: artwork PNG and crawler card
test/               unit tests
tools/              codec sync, function checks, UI checks, perf measurement
```

The codec itself lives outside this repository and is copied in by
`npm run sync-codec`. Editing `src/vendor/codec/` by hand fails the build,
because the manifest hashes will no longer match.

## Contributing / working on this

Read [`AGENTS.md`](./AGENTS.md) first. It describes the conventions this
codebase is held to: what the checks are, why the codec is vendored, and which
invariants must not be broken.

The author keeps a separate, unpublished knowledge base (`_dev/`) holding
working notes and prompt transcripts. `AGENTS.md` refers to it in places; those
paths will be absent from a fresh clone, which is expected and harmless.

Commit messages are in English. Source comments and the wiki are in Korean.

## License

This project is deliberately split, because "the code" and "the pictures" are
very different kinds of thing.

| What | Terms |
| --- | --- |
| Source code | [Apache-2.0](./LICENSE) |
| Artworks produced by the codec | [CC0 1.0](./LICENSE) (public domain dedication) |
| Wiki prose and documentation | [CC-BY-4.0](./LICENSE) |
| Names, logo, and characters | All rights reserved |

Apache-2.0 rather than MIT specifically because it grants patent rights. The
codec is built from long-expired, textbook techniques — DCT, mixed-radix
positional numbering, closed-loop intra prediction — but the surrounding
still-image patent landscape is active enough that an explicit grant is worth
more than brevity.

The artworks are dedicated to the public domain because it is genuinely unclear
that copyright attaches to them at all: each one is a deterministic function of
an integer, with no human authorship in the individual result. CC0 removes the
question instead of answering it.

See [`LICENSE`](./LICENSE) for the full text and exact scope.
