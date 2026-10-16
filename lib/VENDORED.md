# Vendored Substack libraries

TypoHunter includes the small set of library modules it uses from its companion
projects so a checkout can run and test without sibling repositories. These
are source copies; keep behavior aligned with the recorded upstream revisions.

## SubstackCLI

Source: local `SubstackCLI` repository, revision
`6c606907b8c9782b86f721cdfc6b210b3960ff2c`.

Copied modules: `auth.js`, `convert.js`, `drafts.js`, `files.js`,
`frontmatter.js`, `images.js`, and `md.js` into `lib/substack-cli/`.

## SubstackKit

Source: `DanielLourencoJr/SubstackKit`, revision
`1610830c1446bf72ac70299f9c343a1176384f32`.

Copied modules: `lib/args.js` and `lib/convert/html_to_md.js`, keeping their
relative layout under `lib/substack-kit/`.
