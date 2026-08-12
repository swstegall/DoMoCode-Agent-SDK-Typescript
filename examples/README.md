# Examples

Build the SDK first with `npm run build`; the examples import the committed `dist/` artifacts.
They expect a bearer token through the environment and never print it.

- `ci-reviewer.mjs` — read-only review with permissions denied and questions cancelled.
- `batch-refactor.mjs` — launch an isolated server and run several prompts sequentially.
- `question-policy-bot.mjs` — answer structured questions deterministically and deny tools.
- `co-attach.mjs` — show an authority driver beside an observer and release safely when idle.
- `workflow-driver.mjs` — start a durable workflow and apply an explicit approval decision.
- `../browser-tests/dashboard.html` — browser session list/transcript/permission smoke dashboard;
  run `npm install && npx playwright test` from `browser-tests/` for the browser harness.

For remote examples:

```sh
DOMO_URL=http://127.0.0.1:4100 DOMO_TOKEN=... node examples/ci-reviewer.mjs
```

Use short-lived isolated servers for experiments. Do not place tokens in command history or
browser storage; see [`../SECURITY.md`](../SECURITY.md).
