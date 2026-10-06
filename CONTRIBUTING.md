# Contributing

Bug reports and small improvements are welcome. For styling bugs, share a synthetic Markdown example, your theme, enabled snippets, and app/macOS versions. Please don't upload private notes or vault settings.

Run `npm ci`, `npm test`, and `npm run build` before submitting a pull request. Test against a new vault and temporary Quick Look resources; don't modify an existing user's cache while running tests.

For releases, the version in the tag must match `manifest.json`. The release workflow builds, tests, attests, and uploads the plugin files.

For capture changes, also run the optional real-browser regression check:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run test:render
```

It verifies light/dark computed-style round trips for nested lists and contextual emphasis, plus isolation from active vault styles. The normal test suite needs no browser downloads.
