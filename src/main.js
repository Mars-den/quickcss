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
      await this.saveData({ autoSync: this.autoSync, owner: this.owner });
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
    // Cache health checks do not inspect or hash the loaded stylesheets.
    const interval = window.setInterval(() => {
      if (this.disposed || this.shuttingDown) return;
      this.poll();
    }, 5000);
    this.stopBackground = () => {
      headObserver.disconnect();
      appearanceObserver.disconnect();
      window.clearInterval(interval);
    };
    this.register(() => this.stopBackground());
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed || this.shuttingDown) return;
      try {
        if (this.autoSync)
          this.cache.claim(this.owner, this.app.vault.getName());
        this.poll();
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
      await this.saveData({ autoSync: this.autoSync, owner: this.owner });
    } finally {
      this.pendingSettingsWrites--;
    }
  }
  changed() {
    this.tab?.update();
  }
  poll() {
    if (this.disposed || this.shuttingDown) return;
    try {
      const sharedState = this.cache.state();
      if (!sharedState.enabled) {
        this.status =
          this.autoSync && this.owns()
            ? "Waiting to sync current appearance."
            : "Native appearance. Automatic sync is paused or owned by another vault.";
      } else {
        const cacheResult = this.cache.reconcile();
        this.status = `Active: ${sharedState.label} · ${this.owns() ? (this.autoSync ? "automatic sync on" : "sync paused") : "following another vault"}${cacheResult.changed ? " · cache repaired" : ""}.`;
      }
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
      const snapshot = await capture(document, appearance, {
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
    this.poll();
  }
  async syncNow() {
    if (this.busy || this.disposed || this.shuttingDown) return;
    this.busy = true;
    try {
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
    this.poll();
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
class QuickCssSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.generation = 0;
    this.cleanups = [];
  }
  display() {
    this.hide();
    const plugin = this.plugin,
      container = this.containerEl;
    container.empty();
    container.createEl("p", {
      text: "Your theme, CSS snippets and Style Settings selections automatically style native macOS Quick Look.",
    });
    this.status = container.createEl("p", {
      cls: "quickcss-status",
      text: plugin.status,
    });
    new Setting(container)
      .setName("Automatic sync")
      .setDesc(
        "Keep Quick Look up to date with appearance changes in this vault.",
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
    new Setting(container)
      .setName("Current appearance")
      .setDesc(
        "Sync now also makes this vault the owner of the shared macOS appearance.",
      )
      .addButton((button) =>
        button.setButtonText("Sync now / use this vault").onClick(async () => {
          button.setDisabled(true);
          await plugin.syncNow();
          button.setDisabled(false);
        }),
      );
    new Setting(container)
      .setName("Native appearance")
      .setDesc(
        "Restore and pause sync. Disabling QuickCss also restores styling owned by this vault.",
      )
      .addButton((button) =>
        button
          .setButtonText("Restore and pause")
          .onClick(() => plugin.restore()),
      );
    container.createEl("p", {
      text: "One vault owns automatic sync across macOS. Other vaults follow it until you choose “use this vault”. Existing Quick Look panels may need reopening to refresh. Appearance is retained when Obsidian closes normally.",
    });
    this.details = container.createEl("p");
    this.previews = container.createDiv({ cls: "quickcss-previews" });
    this.rendered = null;
    this.update();
  }
  update() {
    if (!this.previews?.isConnected) return;
    this.status.setText(this.plugin.status);
    const snapshot = this.plugin.snapshot;
    if (snapshot === this.rendered) return;
    this.rendered = snapshot;
    this.showSnapshot();
  }
  async showSnapshot() {
    this.previewController?.abort();
    const controller = new AbortController();
    this.previewController = controller;
    const snapshot = this.plugin.snapshot,
      container = this.previews,
      generation = ++this.generation;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    container.empty();
    if (!snapshot) {
      this.details.setText(
        "Preview will appear after the first automatic capture.",
      );
      return;
    }
    this.details.setText(
      `${snapshot.theme} · ${snapshot.snippets.length} snippet(s) · Style Settings ${snapshot.styleSettings ? "included" : "not detected"}${snapshot.skippedStylesheets ? ` · ${snapshot.skippedStylesheets} stylesheet(s) skipped` : ""}`,
    );
    let baseCSS = "";
    try {
      baseCSS = strip(this.plugin.cache.current().source);
    } catch {}
    for (const mode of ["light", "dark"]) {
      try {
        const card = container.createDiv({ cls: "quickcss-preview-card" });
        card.createEl("h3", {
          text: mode === "light" ? "Light preview" : "Dark preview",
        });
        const element = await frame(
          document,
          mode,
          [],
          baseCSS + "\n" + snapshot.css,
          card,
          {
            signal: controller.signal,
          },
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
  }
  hide() {
    this.previewController?.abort();
    this.generation++;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}
