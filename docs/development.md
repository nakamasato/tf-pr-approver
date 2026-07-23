# Development

```bash
npm ci
npm test        # unit tests (vitest)
npm run build   # type-check (tsc)
npm run all     # build + test + package (esbuild → dist/)
```

`dist/` is committed and kept in sync with `src/` — enforced by
[`check-dist`](../.github/workflows/check-dist.yml). Run `npm run package` and
commit `dist/` whenever you change `src/`.

## Releasing

Releases are automated by
[`release`](../.github/workflows/release.yml), which runs
[release-please](https://github.com/googleapis/release-please-action).

1. Land changes on `main` using [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major).
2. release-please keeps a release PR open, bumping `package.json` and
   `CHANGELOG.md`. Merge it when you want to cut a release.
3. Merging creates the immutable tag (`v1.2.3`) and its GitHub Release, then the
   workflow moves the mutable major tag (`v1`) onto that release so consumers
   pinning `@v1` pick it up automatically.

`v1` is force-updated on every v1.x release; `v1.2.3` is never moved. A breaking
change starts a `v2` tag and leaves `v1` frozen at the last v1 release.
