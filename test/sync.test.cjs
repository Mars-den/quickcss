const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { AutomaticSync } = require("../src/sync.cjs");
const { Cache } = require("../src/cache.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quickcss-owner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, "cache");
  fs.mkdirSync(cacheRoot);
  const dir = path.join(cacheRoot, "a".repeat(64));
  fs.mkdirSync(dir);
  fs.symlinkSync(dir, path.join(cacheRoot, "current"));
  const base = "body{--font-text-size:16px}.markdown-rendered{}";
  const file = path.join(dir, "quicklook.css");
  fs.writeFileSync(file, base);
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<link href="quicklook.css"><script src="quicklook.js"></script>',
  );
  fs.writeFileSync(path.join(dir, "quicklook.js"), "onQuickLookReady");
  return { cache: new Cache(cacheRoot, path.join(root, "state")), base, file };
}
const snapshot = {
  schema: 2,
  css: "body.theme-dark{color:purple}",
  theme: "Test",
};
test("automatic ownership refuses silent takeover and stale async writes", (t) => {
  const { cache } = fixture(t);
  assert.equal(cache.claim("A", "vault A"), true);
  cache.applySnapshot(snapshot, "A", "1", "A");
  assert.equal(cache.claim("B", "vault B"), false);
  assert.equal(cache.applySnapshot(snapshot, "B", "1", "B").skipped, true);
  assert.equal(cache.restore("B"), 0);
  assert.equal(cache.state().enabled, true);
  cache.claim("B", "vault B", true);
  assert.equal(cache.applySnapshot(snapshot, "A", "1", "A").skipped, true);
  cache.applySnapshot(snapshot, "B", "1", "B");
  assert.equal(cache.state().label, "B");
});
test("owning vault restoration prevents another instance from repairing removed styling", (t) => {
  const { cache, file, base } = fixture(t);
  cache.claim("A", "A");
  cache.applySnapshot(snapshot, "A", "1", "A");
  assert.equal(cache.restore("A"), 1);
  assert.equal(cache.reconcile().enabled, false);
  assert.equal(fs.readFileSync(file, "utf8"), base);
  assert.equal(cache.claim("B", "B"), false);
});
test("debounces appearance events into one capture/apply", async () => {
  let captures = 0,
    applied = 0;
  const sync = new AutomaticSync({
    delay: 5,
    active: () => true,
    capture: async () => {
      captures++;
      return snapshot;
    },
    apply: () => applied++,
    error: (e) => {
      throw e;
    },
  });
  sync.schedule();
  sync.schedule();
  sync.schedule();
  await new Promise((resolve) => setTimeout(resolve, 25));
  sync.stop();
  assert.equal(captures, 1);
  assert.equal(applied, 1);
});
test("disabling during asynchronous capture cancels the eventual apply", async () => {
  let resolve,
    applied = 0;
  const sync = new AutomaticSync({
    active: () => true,
    capture: () => new Promise((r) => (resolve = r)),
    apply: () => applied++,
    error: (e) => {
      throw e;
    },
  });
  const running = sync.run();
  sync.stop();
  resolve(snapshot);
  await running;
  assert.equal(applied, 0);
});
test("pause or ownership change during capture prevents a stale update", async () => {
  let active = true,
    resolve,
    applied = 0;
  const sync = new AutomaticSync({
    active: () => active,
    capture: () => new Promise((r) => (resolve = r)),
    apply: () => applied++,
    error: (e) => {
      throw e;
    },
  });
  const running = sync.run();
  active = false;
  resolve(snapshot);
  await running;
  assert.equal(applied, 0);
  sync.stop();
});
test("plugin disable invokes restore; orderly app close keeps saved appearance", () => {
  const Module = require("node:module"),
    original = Module._load;
  class Plugin {}
  let QuickCss;
  try {
    Module._load = function (id, ...args) {
      if (id === "obsidian")
        return {
          Plugin,
          PluginSettingTab: class {},
          Notice: class {},
          apiVersion: "1.14.4",
        };
      return original.call(this, id, ...args);
    };
    QuickCss = require("../src/main.js");
  } finally {
    Module._load = original;
  }
  for (const shuttingDown of [false, true]) {
    const p = new QuickCss();
    let restored = 0,
      stopped = 0;
    p.shuttingDown = shuttingDown;
    p.owner = "A";
    p.cache = {
      restore: (owner) => {
        assert.equal(owner, "A");
        restored++;
      },
    };
    p.sync = { stop: () => stopped++ };
    p.onunload();
    assert.equal(p.disposed, true);
    assert.equal(stopped, 1);
    assert.equal(restored, shuttingDown ? 0 : 1);
  }
});

test("quit stops work before unload without any cache restore or new scheduling", () => {
  const Module = require("node:module"),
    original = Module._load;
  let QuickCss;
  try {
    Module._load = function (id, ...args) {
      if (id === "obsidian")
        return {
          Plugin: class {},
          PluginSettingTab: class {},
          Notice: class {},
          apiVersion: "1.14.4",
        };
      return original.call(this, id, ...args);
    };
    delete require.cache[require.resolve("../src/main.js")];
    QuickCss = require("../src/main.js");
  } finally {
    Module._load = original;
  }
  const p = new QuickCss(),
    calls = [];
  p.sync = {
    stop: () => calls.push("stop"),
    schedule: () => calls.push("schedule"),
  };
  p.stopBackground = () => calls.push("disconnect");
  p.captureControllers = new Set([{ abort: () => calls.push("abort") }]);
  p.tab = { hide: () => calls.push("hide") };
  p.cache = { restore: () => calls.push("restore") };
  p.owner = "A";
  p.beginShutdown();
  p.scheduleAppearance();
  p.refreshStatus();
  p.apply(snapshot);
  assert.deepEqual(calls, ["stop", "disconnect", "abort", "hide"]);
  assert.equal(p.shuttingDown, true);
  p.onunload();
  assert.ok(!calls.includes("restore"));
  assert.ok(!calls.includes("schedule"));
});
test("interface focus changes are ignored but theme and custom Style Settings classes remain significant", () => {
  const Module = require("node:module"),
    original = Module._load;
  let QuickCss;
  try {
    Module._load = function (id, ...args) {
      if (id === "obsidian")
        return {
          Plugin: class {},
          PluginSettingTab: class {},
          Notice: class {},
        };
      return original.call(this, id, ...args);
    };
    delete require.cache[require.resolve("../src/main.js")];
    QuickCss = require("../src/main.js");
  } finally {
    Module._load = original;
  }
  const old = global.document;
  try {
    global.document = {
      body: {
        classList: ["theme-dark", "is-focused", "custom-theme-setting"],
        style: { cssText: "" },
      },
      documentElement: { className: "", style: { cssText: "" } },
    };
    const p = new QuickCss(),
      first = p.appearanceKey();
    global.document.body.classList = [
      "custom-theme-setting",
      "theme-dark",
      "is-blurred",
    ];
    assert.equal(p.appearanceKey(), first);
    global.document.body.classList = ["theme-light", "custom-theme-setting"];
    assert.notEqual(p.appearanceKey(), first);
    global.document.body.classList = ["theme-dark", "another-setting"];
    assert.notEqual(p.appearanceKey(), first);
  } finally {
    global.document = old;
  }
});

test("settings saves exclude captured CSS, track pending writes, and stop on shutdown", async () => {
  const Module = require("node:module"),
    original = Module._load;
  let QuickCss;
  try {
    Module._load = function (id, ...args) {
      if (id === "obsidian")
        return {
          Plugin: class {},
          PluginSettingTab: class {},
          Notice: class {},
        };
      return original.call(this, id, ...args);
    };
    delete require.cache[require.resolve("../src/main.js")];
    QuickCss = require("../src/main.js");
  } finally {
    Module._load = original;
  }
  const p = new QuickCss();
  p.autoSync = true;
  p.owner = "A";
  p.selection = { source: "fixed", theme: "Test", snippets: ["extra"] };
  p.snapshot = { css: "large captured theme" };
  let resolve,
    calls = 0;
  p.saveData = (data) => {
    calls++;
    assert.deepEqual(data, {
      autoSync: true,
      owner: "A",
      appearance: p.selection,
    });
    return new Promise((r) => (resolve = r));
  };
  const saving = p.save();
  assert.equal(p.pendingSettingsWrites, 1);
  p.shuttingDown = true;
  await p.save();
  assert.equal(calls, 1);
  resolve();
  await saving;
  assert.equal(p.pendingSettingsWrites, 0);
  p.shuttingDown = false;
  p.saveData = async () => {
    throw Error("disk failure");
  };
  await assert.rejects(p.save(), /disk failure/);
  assert.equal(p.pendingSettingsWrites, 0);
});
