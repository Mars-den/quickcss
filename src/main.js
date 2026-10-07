const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Platform,
  apiVersion,
} = require("obsidian");
const crypto = require("node:crypto");
const { Cache, strip } = require("./cache.cjs");
const { capture, frame, preparePreview } = require("./capture.cjs");
const { AutomaticSync } = require("./sync.cjs");
const { CacheWatcher } = require("./watch.cjs");
const {
  settings,
  installed,
  evaluation,
  watchFiles,
} = require("./appearance.cjs");
module.exports = class QuickCss extends Plugin {
  async onload() {
    if (!Platform.isMacOS) {
      new Notice(
        "QuickCss requires macOS and the native Obsidian Quick Look extension.",
      );
      return;
    }
    this.cache = new Cache();
    const saved = await this.loadData();
    this.snapshot = saved?.snapshot?.schema === 2 ? saved.snapshot : null;
    this.autoSync = saved?.autoSync !== false;
    this.selection = settings(saved?.appearance);
    const vaultPath = this.app.vault.adapter.getBasePath?.();
    this.owner = vaultPath
      ? crypto
          .createHash("sha256")
          .update(vaultPath + "|" + this.app.vault.configDir)
          .digest("hex")
      : saved?.owner || crypto.randomUUID();
    const shared = this.cache.state();
    if (shared.owner === this.owner && shared.snapshot?.schema === 2)
      this.snapshot = shared.snapshot;
    this.pendingSettingsWrites = 0;
    if (saved?.snapshot)
      await this.saveData({
        autoSync: this.autoSync,
        owner: this.owner,
        appearance: this.selection,
      });
    this.status = "Waiting for appearance to load.";
    this.disposed = false;
    this.busy = false;
    this.shuttingDown = false;
    this.sync = new AutomaticSync({
      active: () =>
        !this.disposed &&
        !this.shuttingDown &&
        !this.busy &&
        this.autoSync &&
        this.owns(),
      capture: () => this.captureCurrent(),
      apply: (snapshot) => this.apply(snapshot),
      error: (error) => {
        this.status = `Automatic sync blocked: ${error.message}`;
        this.changed();
      },
    });
    this.tab = new QuickCssSettingsTab(this.app, this);
    this.addSettingTab(this.tab);
    this.addCommand({
      id: "apply",
      name: "Sync current appearance to Quick Look",
      callback: () => this.syncNow(),
    });
    this.addCommand({
      id: "restore",
      name: "Restore native Quick Look CSS and pause sync",
      callback: () => this.restore(),
    });
    this.registerEvent(
      this.app.workspace.on("css-change", () => this.scheduleAppearance()),
    );
    // Let Obsidian own beforeunload and its save/close retry.
    this.registerEvent(
      this.app.workspace.on("quit", () => this.beginShutdown()),
    );
    const headObserver = new MutationObserver((records) => {
      if (
        records.some(
          (mutationRecord) =>
            mutationRecord.target.matches?.("style,link[rel=stylesheet]") ||
            mutationRecord.target.parentElement?.closest("style") ||
            [...mutationRecord.addedNodes, ...mutationRecord.removedNodes].some(
              (changedNode) =>
                changedNode.matches?.("style,link[rel=stylesheet]"),
            ),
        )
      )
        this.scheduleAppearance();
    });
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    const appearanceObserver = new MutationObserver(() => {
      const key = this.appearanceKey();
      if (key !== this.lastAppearanceKey) {
        this.lastAppearanceKey = key;
        this.scheduleAppearance();
      }
    });
    this.lastAppearanceKey = this.appearanceKey();
    for (const element of [document.body, document.documentElement])
      appearanceObserver.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    this.cacheWatcher = new CacheWatcher(this.cache, {
      change: () => this.refreshStatus(),
      error: (error) => {
        this.status = `Cache monitoring unavailable: ${error.message}. Sync now can retry.`;
        this.changed();
      },
    });
    const stopFiles = watchFiles(
      this.app,
      () => this.scheduleAppearance(),
      (error) =>
        new Notice(
          `Appearance file monitoring unavailable: ${error.message}. Use Sync now to refresh selected files.`,
        ),
    );
    this.stopBackground = () => {
      stopFiles();
      headObserver.disconnect();
      appearanceObserver.disconnect();
      this.cacheWatcher.close();
    };
    this.register(() => this.stopBackground());
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed || this.shuttingDown) return;
      this.cacheWatcher.refresh();
      try {
        if (this.autoSync)
          this.cache.claim(this.owner, this.app.vault.getName());
        // A first claim can create the state directory; bind it immediately.
        this.cacheWatcher.refresh();
        this.refreshStatus();
        if (this.autoSync && this.owns()) this.sync.schedule();
      } catch (error) {
        this.status = error.message;
        this.changed();
      }
    });
  }
  owns() {
    try {
      return this.cache.state().owner === this.owner;
    } catch {
      return false;
    }
  }
  appearanceKey() {
    return [
      Array.from(document.body.classList)
        .filter(
          (className) =>
            ![
              "is-focused",
              "is-blurred",
              "is-hidden",
              "is-grabbing",
              "is-dragging",
              "is-resizing",
            ].includes(className),
        )
        .sort()
        .join(" "),
      document.body.style.cssText,
      document.documentElement.className,
      document.documentElement.style.cssText,
    ].join("|");
  }
  scheduleAppearance() {
    if (!this.disposed && !this.shuttingDown) this.sync.schedule();
  }
  cancelCaptures() {
    this.captureEpoch = (this.captureEpoch || 0) + 1;
    for (const controller of this.captureControllers || []) controller.abort();
  }
  stopWork() {
    this.sync?.stop();
    this.stopBackground?.();
    this.cancelCaptures();
    this.tab?.hide();
  }
  beginShutdown() {
    this.shuttingDown = true;
    this.stopWork();
  }
  async save() {
    if (this.disposed || this.shuttingDown) return;
    this.pendingSettingsWrites = (this.pendingSettingsWrites || 0) + 1;
    try {
      await this.saveData({
        autoSync: this.autoSync,
        owner: this.owner,
        appearance: this.selection,
      });
    } finally {
      this.pendingSettingsWrites--;
    }
  }
  changed() {
    this.tab?.update();
  }
  refreshStatus() {
    if (this.disposed || this.shuttingDown) return;
    try {
      const sharedState = this.cache.state();
      const ownsAppearance = sharedState.owner === this.owner;
      if (!sharedState.enabled) {
        this.status =
          this.autoSync && ownsAppearance
            ? "Waiting to sync current appearance."
            : "Native appearance. Automatic sync is paused or owned by another vault.";
      } else {
        // Following vaults observe the shared status without competing to write.
        const cacheResult = ownsAppearance
          ? this.cache.reconcile(this.owner)
          : {};
        if (ownsAppearance) Object.assign(sharedState, this.cache.state());
        this.status =
          sharedState.application && sharedState.application !== "applied"
            ? `Appearance saved; Quick Look application ${sharedState.application}: ${sharedState.applicationError || "waiting for owner to retry"}.`
            : `Active: ${sharedState.label} · ${ownsAppearance ? (this.autoSync ? "automatic sync on" : "sync paused") : "following another vault"}${cacheResult.changed ? " · cache repaired" : ""}.`;
      }
      if (this.cacheWatcher?.error)
        this.status += " Cache monitoring unavailable; use Sync now to retry.";
    } catch (error) {
      this.status = `Blocked: ${error.message}`;
    }
    this.changed();
  }
  async captureCurrent() {
    if (this.disposed || this.shuttingDown)
      throw Object.assign(new Error("QuickCss stopped"), {
        name: "AbortError",
      });
    const selection = settings(this.selection);
    const epoch = this.captureEpoch || 0,
      controller = new AbortController();
    (this.captureControllers ??= new Set()).add(controller);
    try {
      let appearance = {};
      try {
        appearance = JSON.parse(
          await this.app.vault.adapter.read(
            `${this.app.vault.configDir}/appearance.json`,
          ),
        );
      } catch {}
      const source = await evaluation(
        this.app,
        this.cache,
        selection,
        appearance,
      );
      const snapshot = await capture(document, source.appearance, {
        ...source.options,
        signal: controller.signal,
      });
      if (
        this.disposed ||
        this.shuttingDown ||
        controller.signal.aborted ||
        epoch !== (this.captureEpoch || 0)
      )
        throw Object.assign(new Error("QuickCss capture cancelled"), {
          name: "AbortError",
        });
      this.snapshot = snapshot;
      this.changed();
      return snapshot;
    } finally {
      this.captureControllers.delete(controller);
    }
  }
  apply(snapshot) {
    if (this.disposed || this.shuttingDown) return;
    const result = this.cache.applySnapshot(
      snapshot,
      `${this.app.vault.getName()} · ${snapshot.theme}`,
      apiVersion,
      this.owner,
    );
    if (result.skipped) {
      this.status = "Another vault owns automatic sync.";
      this.changed();
      return;
    }
    this.refreshStatus();
  }
  async syncNow() {
    if (this.busy || this.disposed || this.shuttingDown) return;
    this.busy = true;
    try {
      this.cacheWatcher?.refresh();
      this.sync.cancel();
      this.cancelCaptures();
      const epoch = this.captureEpoch;
      this.cache.claim(this.owner, this.app.vault.getName(), true);
      const snapshot = await this.captureCurrent();
      if (!this.disposed && !this.shuttingDown && epoch === this.captureEpoch) {
        this.apply(snapshot);
        new Notice("Appearance synced. Reopen Quick Look to refresh.");
      }
    } catch (error) {
      if (this.disposed || this.shuttingDown || error.name === "AbortError")
        return;
      this.status = `Sync failed: ${error.message}`;
      this.changed();
      new Notice(this.status);
    } finally {
      this.busy = false;
      if (
        this.sync.pending &&
        !this.disposed &&
        !this.shuttingDown &&
        this.autoSync &&
        this.owns()
      )
        this.sync.schedule();
    }
  }
  async setAppearance(changes) {
    if (this.disposed || this.shuttingDown) return;
    this.selection = settings({ ...this.selection, ...changes });
    this.sync.cancel();
    this.cancelCaptures();
    const epoch = this.captureEpoch;
    await this.save();
    if (this.disposed || this.shuttingDown || epoch !== this.captureEpoch)
      return;
    if (this.autoSync && this.owns()) this.sync.schedule();
    this.status =
      this.autoSync && this.owns()
        ? "Waiting to sync selected appearance."
        : "Selection saved. Sync now to apply, or enable automatic sync.";
    this.changed();
  }
  async setAutomatic(value) {
    if (this.disposed || this.shuttingDown) return;
    this.autoSync = value;
    this.sync.cancel();
    this.cancelCaptures();
    const epoch = this.captureEpoch;
    await this.save();
    if (this.disposed || this.shuttingDown || epoch !== this.captureEpoch)
      return;
    if (value) {
      this.cache.claim(this.owner, this.app.vault.getName(), true);
      this.sync.schedule();
    }
    this.refreshStatus();
  }
  async restore() {
    if (this.disposed || this.shuttingDown) return;
    this.autoSync = false;
    this.sync.cancel();
    this.cancelCaptures();
    const epoch = this.captureEpoch;
    await this.save();
    if (this.disposed || this.shuttingDown || epoch !== this.captureEpoch)
      return;
    try {
      if (!this.owns()) {
        new Notice(
          "Another vault owns the shared appearance. Use this vault first to restore it.",
        );
        return;
      }
      const changedNode = this.cache.restore(this.owner);
      this.status = `Restored ${changedNode} cache(s). Automatic sync paused.`;
      new Notice(this.status);
    } catch (error) {
      this.status = `Restore incomplete: ${error.message}`;
      new Notice(this.status);
    }
    this.changed();
  }
  onunload() {
    this.disposed = true;
    this.stopWork();
    if (this.cache && this.owner && !this.shuttingDown) {
      try {
        this.cache.restore(this.owner);
      } catch (error) {
        new Notice(`QuickCss disable cleanup failed: ${error.message}`);
      }
    }
  }
};
const TABS = [
  { id: "overview", name: "Overview" },
  { id: "appearance", name: "Appearance" },
  { id: "preview", name: "Preview" },
  { id: "help", name: "Help" },
];
const HELP = [
  [
    "Sharing between vaults",
    "One vault owns the appearance across macOS. Other vaults follow it until you choose Sync now in one of them.",
  ],
  [
    "Fixed theme",
    "Pick Fixed theme in Appearance to keep Quick Look on one theme. Obsidian’s own theme, fonts, and Style Settings no longer change it, so theme features that rely on them may look different.",
  ],
  [
    "Seeing the old appearance",
    "Close and reopen Quick Look after a change. Finder sometimes caches previews; a newly created Markdown file shows the latest styling.",
  ],
  [
    "Fonts",
    "Quick Look uses your text font, not the interface font. Fonts installed on your Mac work best.",
  ],
  [
    "Undoing QuickCss",
    "Restore and pause, or disable QuickCss in the vault that owns the appearance. The appearance is kept when Obsidian closes normally.",
  ],
  [
    "Missed changes",
    "Appearance changes are detected through Obsidian events. If another plugin changes styling without notifying Obsidian, choose Sync now.",
  ],
];
class QuickCssSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.generation = 0;
    this.cleanups = [];
    this.selected = "overview";
    this.mode = "light";
  }
  display() {
    this.hide();
    const container = this.containerEl;
    container.empty();
    const tabList = container.createDiv({
      cls: "quickcss-tabs",
      attr: { role: "tablist", "aria-label": "QuickCss settings" },
    });
    this.tabs = new Map();
    this.panels = new Map();
    for (const { id, name } of TABS) {
      const tab = tabList.createEl("button", {
        cls: "quickcss-tab",
        text: name,
        attr: {
          type: "button",
          role: "tab",
          id: `quickcss-tab-${id}`,
          "aria-controls": `quickcss-panel-${id}`,
        },
      });
      tab.addEventListener("click", () => this.select(id));
      tab.addEventListener("keydown", (event) => this.moveFocus(event, id));
      this.tabs.set(id, tab);
      this.panels.set(
        id,
        container.createDiv({
          cls: "quickcss-panel",
          attr: {
            role: "tabpanel",
            id: `quickcss-panel-${id}`,
            "aria-labelledby": `quickcss-tab-${id}`,
            tabindex: "0",
          },
        }),
      );
    }
    this.showOverview(this.panels.get("overview"));
    this.sources = this.panels.get("appearance");
    this.showSources();
    this.showPreviewPanel(this.panels.get("preview"));
    this.showHelp(this.panels.get("help"));
    this.rendered = undefined;
    this.select(this.selected);
  }
  showOverview(panel) {
    const plugin = this.plugin;
    this.statusSetting = new Setting(panel)
      .setClass("quickcss-status")
      .addButton((button) =>
        button
          .setButtonText("Sync now")
          .setCta()
          .setTooltip(
            "Also makes this vault the owner of the shared appearance",
          )
          .onClick(async () => {
            button.setDisabled(true);
            await plugin.syncNow();
            button.setDisabled(false);
          }),
      );
    new Setting(panel)
      .setName("Automatic sync")
      .setDesc(
        "Keep Quick Look up to date with the selected source and snippet files.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.autoSync)
          .onChange((v) =>
            plugin
              .setAutomatic(v)
              .catch(
                (error) =>
                  new Notice(`Automatic sync blocked: ${error.message}`),
              ),
          ),
      );
    new Setting(panel)
      .setName("Restore native appearance")
      .setDesc(
        "Remove QuickCss styling from Quick Look and pause automatic sync.",
      )
      .addButton((button) =>
        button
          .setButtonText("Restore and pause")
          .setWarning()
          .onClick(() => plugin.restore()),
      );
  }
  showPreviewPanel(panel) {
    const controls = new Setting(panel)
      .setName("Appearance")
      .setDesc(
        "Previews use your text font. The interface font only affects Obsidian's menus and settings.",
      );
    const group = controls.controlEl.createDiv({
      cls: "quickcss-segmented",
      attr: { role: "group", "aria-label": "Preview appearance" },
    });
    this.modeButtons = new Map();
    for (const mode of ["light", "dark"]) {
      const button = group.createEl("button", {
        text: mode === "light" ? "Light" : "Dark",
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        this.mode = mode;
        this.update();
      });
      this.modeButtons.set(mode, button);
    }
    this.previews = panel.createDiv({ cls: "quickcss-preview" });
  }
  showHelp(panel) {
    for (const [name, description] of HELP)
      new Setting(panel).setName(name).setDesc(description);
  }
  async showSources() {
    const generation = (this.sourceGeneration =
        (this.sourceGeneration || 0) + 1),
      container = this.sources,
      plugin = this.plugin;
    container.empty();
    const change = (values) =>
      plugin
        .setAppearance(values)
        .catch(
          (error) =>
            new Notice(`Appearance selection failed: ${error.message}`),
        );
    new Setting(container)
      .setName("Appearance source")
      .setDesc(
        "Fixed theme uses native reading defaults and ignores this vault’s active theme and Style Settings.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vault", "Follow this vault")
          .addOption("fixed", "Fixed theme")
          .setValue(plugin.selection.source)
          .onChange(async (source) => {
            await change({ source });
            this.showSources();
          }),
      );
    try {
      const choices = await installed(
        this.app.vault.adapter,
        this.app.vault.configDir,
      );
      if (generation !== this.sourceGeneration || !container.isConnected)
        return;
      if (plugin.selection.source === "fixed") {
        new Setting(container).setName("Theme").addDropdown((dropdown) => {
          dropdown.addOption("", "Default");
          for (const theme of choices.themes) dropdown.addOption(theme, theme);
          if (
            plugin.selection.theme &&
            !choices.themes.includes(plugin.selection.theme)
          )
            dropdown.addOption(
              plugin.selection.theme,
              `${plugin.selection.theme} (missing)`,
            );
          dropdown
            .setValue(plugin.selection.theme)
            .onChange((theme) => change({ theme }));
        });
      }
      new Setting(container)
        .setName("Quick Look snippets")
        .setDesc(
          plugin.selection.source === "fixed"
            ? "Only snippets selected here are added after the theme, in name order. Changes apply on the next sync."
            : "Selected files are added after this vault’s enabled snippets; these toggles can’t disable them. Changes apply on the next sync.",
        )
        .setHeading()
        .addExtraButton((button) =>
          button
            .setIcon("refresh-cw")
            .setTooltip("Refresh installed files")
            .onClick(() => this.showSources()),
        );
      const names = [
        ...new Set([...choices.snippets, ...plugin.selection.snippets]),
      ].sort();
      if (!names.length)
        container.createEl("p", {
          cls: "setting-item-description",
          text: "No .css files in the snippets folder.",
        });
      for (const name of names) {
        new Setting(container)
          .setName(name + (choices.snippets.includes(name) ? "" : " (missing)"))
          .addToggle((toggle) =>
            toggle
              .setValue(plugin.selection.snippets.includes(name))
              .onChange((enabled) =>
                change({
                  snippets: enabled
                    ? [...plugin.selection.snippets, name]
                    : plugin.selection.snippets.filter((item) => item !== name),
                }),
              ),
          );
      }
    } catch (error) {
      container.createEl("p", {
        text: `Appearance files unavailable: ${error.message}`,
      });
    }
  }
  select(id, focus = false) {
    this.selected = id;
    for (const [tabId, tab] of this.tabs) {
      const active = tabId === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.toggleClass("is-active", active);
      this.panels.get(tabId).hidden = !active;
    }
    if (focus) this.tabs.get(id).focus();
    this.update();
  }
  moveFocus(event, id) {
    const index = TABS.findIndex((tab) => tab.id === id);
    const next = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: TABS.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.select(TABS[(next + TABS.length) % TABS.length].id, true);
  }
  update() {
    if (!this.previews?.isConnected) return;
    const snapshot = this.plugin.snapshot;
    this.statusSetting.setName(this.plugin.status);
    this.statusSetting.setDesc(
      snapshot
        ? `${snapshot.theme} · ${snapshot.snippets.length} snippet(s) · Style Settings ${snapshot.styleSettings ? "included" : "not detected"}${snapshot.skippedStylesheets ? ` · ${snapshot.skippedStylesheets} stylesheet(s) skipped` : ""}`
        : "Waiting for the first automatic capture.",
    );
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute("aria-pressed", String(mode === this.mode));
      button.toggleClass("is-active", mode === this.mode);
    }
    // Previews render only while visible; a hidden tab catches up when selected.
    if (this.selected !== "preview") return;
    if (snapshot === this.rendered && this.mode === this.renderedMode) return;
    this.rendered = snapshot;
    this.renderedMode = this.mode;
    this.showSnapshot();
  }
  async showSnapshot() {
    this.previewController?.abort();
    const controller = new AbortController();
    this.previewController = controller;
    const snapshot = this.plugin.snapshot,
      mode = this.mode,
      container = this.previews,
      generation = ++this.generation;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    container.empty();
    if (!snapshot) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "Preview will appear after the first automatic capture.",
      });
      return;
    }
    let baseCSS = "";
    try {
      baseCSS = strip(this.plugin.cache.current().source);
    } catch {}
    try {
      const element = await frame(
        document,
        mode,
        [],
        baseCSS + "\n" + snapshot.css,
        container,
        { signal: controller.signal },
      );
      if (generation !== this.generation || !container.isConnected) {
        element.remove();
        return;
      }
      this.cleanups.push(preparePreview(element, mode, container));
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      container.createEl("p", {
        text: `Preview unavailable: ${error.message}`,
      });
    }
  }
  hide() {
    this.sourceGeneration = (this.sourceGeneration || 0) + 1;
    this.previewController?.abort();
    this.generation++;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.rendered = undefined;
  }
}
