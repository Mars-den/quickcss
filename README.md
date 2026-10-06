# QuickCss

Your notes look the way you want in Obsidian. They should feel familiar when you preview them in Finder, too.

QuickCss brings your theme, CSS snippets, and Style Settings choices to macOS Quick Look. Fonts, colors, headings, tables, code blocks, quotations, task checkboxes, and common callouts follow your reading appearance automatically. Change your theme and QuickCss picks it up—no second set of appearance sliders to maintain.

## Before you install

Obsidian added Markdown Quick Look previews in [version 1.14](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.0/). **You need a recent installer**, not just an in-app update. If you've been updating the same installation for a while, [download Obsidian again](https://obsidian.md/download) and reinstall it to get the native extension.

You'll need macOS and Obsidian **1.14.4 or later**. Before installing QuickCss, select a Markdown file in Finder and press **Space**. Obsidian's Markdown preview should already work. QuickCss styles that preview; it doesn't install the extension itself.

Style Settings is optional. If you use it, QuickCss follows its choices along with your enabled snippets and current theme.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Mars-den/quickcss/releases/latest).
2. Create a `quickcss` folder in your vault's `.obsidian/plugins` folder.
3. Put the three files inside it.
4. Restart Obsidian and enable **QuickCss** in **Settings → Community plugins**.

If your vault uses a custom configuration folder, use its `plugins` folder instead.

## Try it out

Once enabled, QuickCss captures your reading appearance and keeps it in sync. Select a Markdown file in Finder, press **Space**, and take a look.

Open **Settings → QuickCss** for sample light and dark previews. They use your **text font**; the **interface font** is a separate setting for Obsidian's menus and settings.

Already have a Quick Look window open? Close it and open it again after changing your appearance. Existing previews can hang onto the old styling.

| Control | When to use it |
| --- | --- |
| Automatic sync | Leave this on to follow theme, snippet, and Style Settings changes. Turning it off keeps the last applied appearance. |
| Sync now / use this vault | Refresh immediately, or switch which vault supplies the appearance. |
| Restore and pause | Go back to the native preview and stop syncing. |

### A note about multiple vaults

Quick Look belongs to your Mac, so all your vaults share one preview appearance. One vault supplies the styling at a time. Choose **Sync now / use this vault** when you want another vault's look instead.

Disabling QuickCss in the source vault restores the native styling. Disabling it in a following vault leaves the source's styling alone. Closing Obsidian normally keeps your last appearance available in Finder.

## A few things to know

Quick Look and Obsidian use different renderers, so some text and layout details may differ. Fonts installed on your Mac work best; fonts supplied only through a theme or a download may fall back.

Editor styling, plugin widgets, note-specific CSS classes, interactive effects, and unusual callouts aren't fully supported. External images and font assets aren't copied. Simple inline SVG checkbox marks can be captured.

QuickCss works through Obsidian's **undocumented Quick Look cache**, so an Obsidian or macOS update could change how it works. This is an independent plugin.

## Something looks wrong?

**No Markdown preview in Finder?** Download and reinstall the latest Obsidian installer first. If another app handles Markdown previews on your Mac, make sure you're seeing Obsidian's native preview.

**Still seeing the old appearance?** Choose **Sync now / use this vault**, then close and reopen Quick Look. Finder sometimes caches previews; try a newly created Markdown file if it keeps showing the old one.

**Seeing another vault's theme?** Open the vault you want and choose **Sync now / use this vault**.

**Wrong font?** Check your text/reading font in Obsidian or Style Settings, rather than the interface font. Try a font installed on your Mac.

**Want to undo it?** Choose **Restore and pause**, or disable QuickCss in the source vault. Reopen Quick Look afterward.

## Privacy and file access

Everything happens locally. QuickCss has no telemetry, network requests, account requirement, or advertising. It reads appearance styles and settings, checks them against sample Markdown, and saves the resulting styling. **It does not read or edit your notes.**

Finder previews live outside your vault, so QuickCss accesses:

- `~/Library/Application Support/obsidian/quicklook/` to add a removable CSS block to the native Quick Look cache.
- `~/Library/Application Support/QuickCss/` to keep the shared appearance, source-vault label, and original CSS backups.

Restoration removes QuickCss's own block and keeps unrelated CSS. It doesn't modify the signed Obsidian application bundle or run a background service after Obsidian closes.

## Bugs and ideas

[Open an issue](https://github.com/Mars-den/quickcss/issues). For a styling mismatch, a small example note and screenshots of the two previews help. Please use sample content rather than private notes.

## Build from source

```sh
npm ci
npm test
npm run build
```

Install the generated `main.js` with `manifest.json` and `styles.css`. Releases are built in GitHub Actions with artifact attestations for the three files.

## License

[MIT](LICENSE) © 2026 Mars-den.
