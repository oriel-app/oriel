---
name: release
description: Tag and publish a release. Run by the maintainer only.
disable-model-invocation: true
---

1. On an up-to-date `main` with CI green, run `pnpm check`.
2. Work out the next version from the conventional commits since the last tag: `feat` bumps minor, `fix` bumps patch. Stay on 0.x until pilots.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. `gh release create vX.Y.Z --generate-notes`, under the maintainer's own login.
