const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Cache, atomic, strip } = require("../src/cache.cjs");
const { CacheWatcher } = require("../src/watch.cjs");

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline)
      assert.fail("Filesystem notification did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fixture(t, missing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quickcss-watch-"));
  const cache = new Cache(path.join(root, "cache"), path.join(root, "state"));
  const base = "body{--font-text-size:16px}.markdown-rendered{}";
  const snapshot = { schema: 2, css: "body{color:purple}" };
  function generation(id) {
    const directory = path.join(cache.root, id.repeat(64));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "quicklook.css"), base);
    fs.writeFileSync(path.join(directory, "quicklook.js"), "onQuickLookReady");
    fs.writeFileSync(
      path.join(directory, "index.html"),
      '<link href="quicklook.css"><script src="quicklook.js"></script>',
    );
    const temporary = path.join(cache.root, "next");
    fs.symlinkSync(directory, temporary);
    fs.renameSync(temporary, path.join(cache.root, "current"));
    return path.join(directory, "quicklook.css");
  }
  let changes = 0;
  const errors = [];
  const watcher = new CacheWatcher(cache, {
    delay: 10,
    change: () => {
      changes++;
      cache.reconcile("A");
    },
    error: (error) => errors.push(error),
  });
  if (!missing) {
    generation("a");
    cache.claim("A", "A");
    cache.applySnapshot(snapshot, "A", "1", "A");
  }
  watcher.refresh();
  t.after(() => {
    watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  return {
    root,
    cache,
    watcher,
    base,
    snapshot,
    generation,
    changes: () => changes,
  };
}

test("directory watches survive repeated atomic CSS replacement without a write feedback loop", async (t) => {
  const { cache, watcher, base, changes } = fixture(t);
  const file = cache.current().file;
  let locks = 0;
  const locked = cache.locked.bind(cache);
  cache.locked = (operation) => {
    locks++;
    return locked(operation);
  };
  for (let i = 1; i <= 2; i++) {
    atomic(file, base);
    await waitFor(() => fs.readFileSync(file, "utf8").includes("color:purple"));
    // Wait for the repair's own event too: it must not take another lock.
    await waitFor(() => changes() >= i * 2);
    assert.equal(locks, i);
    assert.equal(watcher.timer, null);
  }
});

test("current symlink changes retarget watchers to the new renderer generation", async (t) => {
  const { cache, watcher, base, generation } = fixture(t);
  const file = generation("b");
  await waitFor(() => fs.readFileSync(file, "utf8").includes("color:purple"));
  assert.ok(watcher.watchers.has(fs.realpathSync(path.dirname(file))));
  assert.ok(
    !watcher.watchers.has(
      path.join(fs.realpathSync(cache.root), "a".repeat(64)),
    ),
  );
  atomic(file, base);
  await waitFor(() => fs.readFileSync(file, "utf8").includes("color:purple"));
});

test("missing and recreated cache/state directories are discovered through their parents", async (t) => {
  const { root, cache, watcher, generation, snapshot } = fixture(t, true);
  const file = generation("a");
  cache.claim("A", "A");
  cache.applySnapshot(snapshot, "A", "1", "A");
  await waitFor(
    () =>
      watcher.watchers.has(cache.stateRoot) &&
      watcher.watchers.has(fs.realpathSync(path.dirname(file))),
  );
  const movedCache = path.join(root, "old-cache");
  fs.renameSync(cache.root, movedCache);
  const nextFile = generation("b");
  const movedState = path.join(root, "old-state");
  fs.renameSync(cache.stateRoot, movedState);
  fs.mkdirSync(cache.stateRoot);
  fs.copyFileSync(path.join(movedState, "profile.json"), cache.stateFile);
  await waitFor(() =>
    fs.readFileSync(nextFile, "utf8").includes("color:purple"),
  );
  await waitFor(
    () =>
      watcher.watchers.get(cache.stateRoot)?.stat.ino ===
      fs.statSync(cache.stateRoot).ino,
  );
});

test("shared profile replacements notify followers, which cannot repair another owner's CSS", async (t) => {
  const { cache, base, changes } = fixture(t);
  const file = cache.current().file;
  cache.claim("B", "B", true);
  await waitFor(() => changes() > 0);
  const count = changes();
  atomic(file, base);
  await waitFor(() => changes() > count);
  assert.equal(fs.readFileSync(file, "utf8"), base);
  assert.equal(cache.state().owner, "B");
});

test("closing cancels queued callbacks and releases every watcher", async (t) => {
  const { cache, watcher, base, changes } = fixture(t);
  watcher.schedule();
  assert.ok(watcher.timer);
  watcher.close();
  assert.equal(watcher.timer, null);
  assert.equal(watcher.watchers.size, 0);
  atomic(cache.current().file, base);
  watcher.schedule();
  watcher.refresh();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(changes(), 0);
  assert.equal(strip(cache.current().source), base);
});

test("idle monitoring and unrelated files do not schedule cache checks", async (t) => {
  const { cache, watcher, changes } = fixture(t);
  await waitFor(() => changes() > 0 && watcher.timer === null);
  const before = changes();
  fs.writeFileSync(
    path.join(cache.stateRoot, "write.lock"),
    "unrelated lock event",
  );
  fs.writeFileSync(path.join(cache.root, "unrelated.txt"), "ignored");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(changes(), before);
  assert.equal(watcher.timer, null);
});

test("late duplicate directory notifications do not repeat settled checks, but resource edits still notify", async (t) => {
  const { cache, watcher, changes } = fixture(t);
  await waitFor(() => changes() > 0 && watcher.timer === null);
  const before = changes();
  // Reproduce a native event delivered after the registration debounce has
  // already fired, including platforms that cannot identify the changed name.
  watcher.schedule();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(changes(), before);
  atomic(
    cache.stateFile,
    JSON.stringify({ ...cache.state(), ownerLabel: "renamed" }),
  );
  await waitFor(() => changes() > before);
  assert.equal(cache.state().ownerLabel, "renamed");
});
