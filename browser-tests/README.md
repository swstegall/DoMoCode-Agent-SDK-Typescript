# Browser smoke workspace

This CI-only workspace runs the browser-safe SDK against the Node TCP adapter for
`MockDoMoServer`. It deliberately exercises real `fetch`, CORS preflight, and the
`ReadableStream.getReader()` SSE path in Chromium and WebKit.

From this directory, install the test-only Playwright dependency and browsers, then run:

```sh
npm install
npx playwright install chromium webkit
npm test
```

The root package remains zero-runtime-dependency. The Node TCP adapter is exported from
`domocode-agent-sdk/testing`; the root SDK entry remains free of Node imports.
