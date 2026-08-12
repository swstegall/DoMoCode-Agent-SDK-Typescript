# Release process

Releases use semver git tags. A release commit must contain the generated `dist/` tree and the
matching generated type files. CI rebuilds the tree and fails if it differs from the committed
artifacts. Consumers install a tag or commit directly from GitHub; npm publication is out of
scope.

Build output is treated as generated source. Resolve `dist/` merge conflicts by rebuilding from
the source tree rather than editing emitted files.
