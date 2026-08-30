# Licensing scope

This project contains several different kinds of material, and one license does
not fit all of them. This file says exactly which terms apply to what.

If anything here is ambiguous, the intent is: **the machinery is free, the
pictures are free, the identity is not.**

## Summary

| Material | Terms | SPDX |
| --- | --- | --- |
| Source code, build tooling, tests, configuration | Apache License 2.0 | `Apache-2.0` |
| Artworks produced by the codec, and addresses | Public domain dedication | `CC0-1.0` |
| Documentation prose and the wiki | Creative Commons Attribution 4.0 | `CC-BY-4.0` |
| Project name, logo, and characters | All rights reserved | — |

The full Apache-2.0 text is in [`LICENSE`](./LICENSE).

## 1. Source code — Apache-2.0

Everything under `src/`, `api/`, `test/`, `tools/`, plus the root
configuration files.

Apache-2.0 was chosen over MIT for one reason: **it grants patent rights
explicitly.** The compression machinery here is assembled from techniques old
enough to be textbook material — the discrete cosine transform, mixed-radix
positional numbering, closed-loop intra prediction, chroma subsampling. None of
that is anyone's exclusive property today.

But "the underlying math is free" and "no one will ever assert a patent near
this" are different claims, and only the first is safe to make. Still-image and
video coding remains an active licensing area. Apache-2.0 gives every user an
explicit, irrevocable patent grant from the author and terminates it for anyone
who sues over patents. MIT offers neither. The cost of that protection is a
longer license file, which is not a real cost.

### The vendored codec

`src/vendor/codec/` is a copy of the codec, which is developed in a separate
tree and synchronised by `npm run sync-codec`. It is by the same author and
under the same Apache-2.0 terms. It is vendored rather than published as a
package because its contents are verified by a sha256 manifest at build time:
the build fails if the copy drifts, which is the mechanism that keeps addresses
stable.

## 2. Artworks — CC0 1.0

Every image this project renders, and every address string that identifies one,
is placed in the public domain.

This is a deliberate answer to a genuinely unsettled question. Each artwork is a
deterministic function of an integer. Nobody chose its composition; nobody
selected its colours; the author wrote the function, not the output. Whether
copyright attaches to such a result at all is unclear, and the answer likely
differs between jurisdictions.

Rather than assert a right that may not exist — or leave users guessing — the
author waives any right that might exist. Print them, sell them, mint them,
tattoo them. No attribution required, no permission needed.

**This does not extend to images you supply.** If you use a tool in this project
that reads an image you provide in order to find a nearby address, your image
remains yours and this dedication has nothing to say about it.

## 3. Documentation and wiki — CC-BY-4.0

The explanatory prose: the wiki, `README.md`, `AGENTS.md`, and this file.

Prose is ordinary human authorship, so ordinary terms apply. Reuse it, translate
it, quote it, build on it — just credit the source. Code samples *inside* the
documentation are Apache-2.0 like the rest of the code, not CC-BY.

## 4. Name, logo, and characters — all rights reserved

Not licensed:

- The names "Museum of Babel" / "바벨의 미술관", and the `museumofbabel` marks
- The logo and logo mark
- Any original character introduced into the project — design, name,
  personality, and dialogue — including the curator

Apache-2.0 already declines to grant trademark rights (section 6), and this
section extends the same reservation to characters and visual identity.

The reasoning is that these are the only parts of the project that are *not*
mathematics. An infinite gallery derived from integers belongs to everyone; a
character someone drew and wrote does not become common property by sitting in
the same repository. You may fork the code and run your own gallery. Please give
it your own name and your own cast.

Fan art, fan fiction, and non-commercial derivative works of the characters are
welcomed and will not be pursued. If you want something in writing for a
commercial use, ask.

## Notes

- **Adding features does not change any of this.** New functionality — QR code
  generation, stained-glass rendering, whatever comes next — is code, and lands
  under Apache-2.0 like the rest. Only genuinely new *kinds* of material would
  need a new row in the table above.
- **Adding a character does not change this either.** Section 4 already covers
  characters that do not exist yet.
- **Already-published versions stay published.** These terms are irrevocable
  for the versions they shipped with. Anyone who obtained a copy under
  Apache-2.0 keeps that grant for that copy, permanently. The author may change
  the terms for *future* versions, but cannot retroactively withdraw a past
  grant, and does not intend to try.
