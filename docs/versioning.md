# Versioning and compatibility

The SDK and DoMoCode share protocol version 1. The compatibility rules are intentionally
asymmetric:

| Change | Protocol version | SDK behavior |
| --- | --- | --- |
| New event type or optional response field | stays 1 | Decode known additions; preserve unknown frames as `{type, raw}`. |
| New enum value from the server | stays 1 | Preserve the open string and keep processing. |
| Existing field renamed, removed, or retyped | bump required | Refuse or report a typed decode error. |
| Connected framing/protocol contract changed | bump required | `ProtocolMismatchError`; do not guess. |
| New route/capability | stays 1 | Feature-detect capability strings and tolerate 404 where documented. |

SDK releases use semver git tags and ship generated `dist/` artifacts in every release commit.
The TypeScript source, `schema/protocol.schema.json`, generated types, and `dist/` are kept in
one change. Consumers installing a GitHub commit should pin a tag or commit for reproducible
automation.

The SDK currently targets Node.js 20.4+ and modern browser fetch/streams. The root entry point
is runtime-neutral; the `./node` entry point contains process launch, filesystem, and loopback
OAuth helpers. The `./testing` entry point is public test infrastructure, not a production
runtime dependency.

At startup, probe `client.capabilities()` when available. The `capabilities` array is additive;
unknown strings are expected. For older servers, use the documented 404-tolerant fallbacks and
avoid assuming that a missing capability is equivalent to an empty catalog.
