# QuickCss

Make macOS Quick Look Markdown previews in Finder look like your Obsidian notes.

QuickCss brings your reading fonts, colors, headings, tables, code blocks, quotations, tasks, and common callouts to macOS Quick Look. It follows your active theme, enabled CSS snippets, and Style Settings choices automatically. There are no extra appearance sliders to configure.

Quick Look (also called QuickLook) is the preview opened by pressing **Space** in Finder. QuickCss automatically syncs your Markdown preview styling from Obsidian.

## Requirements

- macOS with Obsidian 1.14.4 or later.
- Obsidian’s native Markdown Quick Look extension installed and working.
- Style Settings is optional. QuickCss uses its choices when the plugin is present.

QuickCss is available from [GitHub releases](https://github.com/Mars-den/quickcss/releases). Community directory availability depends on review.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Mars-den/quickcss/releases/latest).
2. Create a `quickcss` folder inside your vault’s plugin folder, usually `.obsidian/plugins/quickcss`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into it.
4. Restart Obsidian and enable **QuickCss** in **Settings → Community plugins**.

If you use a custom Obsidian configuration folder, place QuickCss in that folder’s `plugins` directory instead.

## Use

Once enabled, QuickCss captures your reading appearance and keeps it up to date as you change your theme, snippets, or Style Settings.

Select a Markdown file in Finder and press **Space** to open Quick Look. Close and reopen the preview after an appearance change. Open **Settings → QuickCss** to see sample light and dark previews and sync status.

The previews use your **text font**. Your **interface font** controls Obsidian’s settings and other interface text separately.

### Controls

| Control | What it does |
| --- | --- |
| Automatic sync | Keeps Quick Look styling up to date with this vault’s appearance. Turning it off leaves the last applied appearance in place. |
| Sync now / use this vault | Refreshes the appearance immediately and makes this vault the source for Quick Look styling. |
| Restore and pause | Removes QuickCss styling and stops automatic sync. |

### If you use several vaults

Quick Look styling is shared across your macOS user account. One vault supplies the appearance; other vaults follow it. Choose **Sync now / use this vault** to switch the source.

Disabling QuickCss in the source vault removes its styling. Disabling it in another vault leaves the source vault’s styling alone. Closing Obsidian normally keeps the last applied appearance available in Finder.

## What to expect

QuickCss aims to match Obsidian’s reading appearance, but Quick Look uses a different renderer. Text rendering and some layout details can differ.

- Locally available fonts work; fonts available only through theme files or downloads may fall back.
- Editor styling, plugin widgets, note-specific CSS classes, interactive effects, and unusual callouts are not fully supported.
- External images and font assets are not copied. Simple inline SVG task checkmarks can be captured.
- The settings previews use sample content and may differ slightly from the actual native preview.

QuickCss uses Obsidian’s **undocumented Quick Look cache**. Obsidian or macOS updates may change how it works. This plugin is an independent project and is not an official Obsidian feature.

## Troubleshooting

**Quick Look still shows the old appearance**

Close the preview, choose **Sync now / use this vault**, and reopen it. Finder may retain a cached preview; test a newly created Markdown file if necessary.

**Another vault’s theme appears**

Open QuickCss settings in the vault you want to use and choose **Sync now / use this vault**.

**The font looks different**

Check your reading/text font in Obsidian or Style Settings, rather than the interface font. Use a font installed on your Mac if the chosen font is supplied only by a theme.

**Sync reports missing or unsupported Quick Look resources**

Check that a Markdown file opens with Obsidian’s native Quick Look extension. QuickCss styles that extension; it does not install it or replace another Markdown preview app.

**You want the original appearance back**

Choose **Restore and pause**, or disable QuickCss in the source vault. Close and reopen Quick Look afterward.

## Privacy and file access

QuickCss works locally. It has no telemetry, network requests, account requirement, or advertising. It reads loaded appearance styles and settings, evaluates them against sample Markdown, and saves the resulting appearance. It does not read or edit your notes.

To style Finder previews, it accesses files outside your vault:

- `~/Library/Application Support/obsidian/quicklook/` — adds a removable CSS block to Obsidian’s native Quick Look cache.
- `~/Library/Application Support/QuickCss/` — stores the shared appearance, source-vault label, and original CSS backups.

Restoration removes QuickCss’s own block and preserves unrelated CSS. The signed Obsidian application bundle is not modified, and no background service runs when Obsidian is closed.

## Build from source

```sh
npm ci
npm test
npm run build
```

Install the generated `main.js` with `manifest.json` and `styles.css` using the steps above.

## License

[MIT](LICENSE) © 2026 Mars-den.
