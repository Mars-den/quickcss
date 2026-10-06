const path = require("node:path");
const fs = require("node:fs");
const { strip } = require("./cache.cjs");

function settings(saved = {}) {
  saved ??= {};
  return {
    source: saved.source === "fixed" ? "fixed" : "vault",
    theme: typeof saved.theme === "string" ? saved.theme : "",
    snippets: Array.isArray(saved.snippets)
      ? [
          ...new Set(saved.snippets.filter((name) => typeof name === "string")),
        ].sort()
      : [],
  };
}
function segment(name) {
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name))
    throw Error("Invalid appearance file name");
  return name;
}
async function installed(adapter, configDir) {
  const list = async (directory) => {
    try {
      return await adapter.list(directory);
    } catch (error) {
      if (await adapter.exists(directory)) throw error;
      return { files: [], folders: [] };
    }
  };
  const themes = await list(`${configDir}/themes`);
  const snippets = await list(`${configDir}/snippets`);
  return {
    themes: themes.folders.map((folder) => folder.split("/").pop()).sort(),
    snippets: snippets.files
      .filter((file) => file.endsWith(".css"))
      .map((file) => file.split("/").pop().slice(0, -4))
      .sort(),
  };
}
async function evaluation(app, cache, selection, appearance) {
  const adapter = app.vault.adapter,
    config = app.vault.configDir;
  const fixed = selection.source === "fixed";
  const enabled = fixed ? [] : appearance.enabledCssSnippets || [];
  const extras = selection.snippets.filter((name) => !enabled.includes(name));
  const readSnippet = (name) =>
    adapter.read(`${config}/snippets/${segment(name)}.css`);
  let styles;
  if (fixed) {
    // The native renderer provides a stable reading baseline, independent of
    // Obsidian's current theme, plugin styles, body classes and inline settings.
    styles = strip(cache.current().source);
    if (selection.theme)
      styles +=
        "\n" +
        (await adapter.read(
          `${config}/themes/${segment(selection.theme)}/theme.css`,
        ));
  }
  const snippets = await Promise.all(extras.map(readSnippet));
  return {
    appearance: {
      ...appearance,
      cssTheme: fixed ? selection.theme || "Default" : appearance.cssTheme,
      enabledCssSnippets: [
        ...new Set([...enabled, ...selection.snippets]),
      ].sort(),
    },
    options: fixed
      ? {
          styles: styles + "\n" + snippets.join("\n"),
          classes: [],
          inline: false,
        }
      : { extraStyles: snippets.join("\n") },
  };
}
// Watch only appearance directories, plus their parent for creation/replacement.
// Plugin data and note files do not acquire recursive watches.
function watchFiles(app, changed, error = () => {}) {
  const root = app.vault.adapter.getBasePath?.();
  if (!root) return () => {};
  const directory = path.join(root, app.vault.configDir);
  const watchers = new Map();
  let closed = false,
    settleTimer;
  const refresh = () => {
    if (closed) return;
    let attached = false;
    for (const folder of [
      directory,
      path.join(directory, "themes"),
      path.join(directory, "snippets"),
    ]) {
      let stat;
      try {
        stat = fs.statSync(folder);
      } catch (failure) {
        if (failure.code !== "ENOENT") error(failure);
      }
      const previous = watchers.get(folder);
      if (
        previous &&
        (!stat || stat.ino !== previous.ino || stat.dev !== previous.dev)
      ) {
        previous.watcher.close();
        watchers.delete(folder);
      }
      if (!stat || watchers.has(folder)) continue;
      try {
        const watcher = fs.watch(
          folder,
          { recursive: folder !== directory, persistent: false },
          (_event, file) => {
            if (closed) return;
            if (
              folder === directory &&
              file &&
              !["themes", "snippets"].includes(file.toString())
            )
              return;
            refresh();
            changed();
          },
        );
        watcher.on("error", (failure) => {
          watcher.close();
          watchers.delete(folder);
          error(failure);
        });
        watchers.set(folder, { watcher, ino: stat.ino, dev: stat.dev });
        attached = true;
      } catch (failure) {
        error(failure);
      }
    }
    // Native recursive watch registration can miss a write immediately after
    // attachment. One deferred capture covers that gap without idle polling.
    if (attached) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!closed) changed();
      }, 100);
      settleTimer.unref?.();
    }
  };
  refresh();
  return () => {
    closed = true;
    clearTimeout(settleTimer);
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  };
}
module.exports = { settings, installed, evaluation, watchFiles };
