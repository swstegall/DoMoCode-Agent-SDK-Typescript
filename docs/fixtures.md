# Wire fixtures

The committed fixtures are Authorization-scrubbed examples of the protocol v1 event plane.
`future-frame.json` verifies the unknown-frame door; `negative-connected.json` is intentionally
malformed and is consumed by decoder tests. Live capture should be performed against an isolated
`domo --serve` process with the scripted gateway and must pass through `scrubSecrets` before a
fixture is committed.

The local Swift toolchain used by this checkout is 6.2.3 while DoMoCode's manifest requires
Swift 6.3 APIs, so this repository's capture harness is ready for live use but the current
environment cannot run the Swift-backed capture until a compatible toolchain is installed.
