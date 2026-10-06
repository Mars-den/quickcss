# Contributing

Bug reports and small improvements are welcome. For styling bugs, share a synthetic Markdown example, your theme, enabled snippets, and app/macOS versions. Please don't upload private notes or vault settings.

Run `npm ci`, `npm test`, and `npm run build` before submitting a pull request. Test against a new vault and temporary Quick Look resources; don't modify an existing user's cache while running tests.

For releases, the version in the tag must match `manifest.json`. The release workflow builds, tests, attests, and uploads the plugin files.
