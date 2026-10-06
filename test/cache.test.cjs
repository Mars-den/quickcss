const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Cache, patch, strip, atomic, BEGIN, END } = require("../src/cache.cjs");
const snapshot = { schema: 2, css: "body{font-size:16px}", theme: "Test" };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quickcss-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, "cache");
  fs.mkdirSync(cacheRoot);
  const cache = new Cache(cacheRoot, path.join(root, "state"));
  const base = "body { --font-text-size:16px; } .markdown-rendered{}\n";
  function generation(id) {
    const dir = path.join(cacheRoot, id.repeat(64));
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "quicklook.css"), base);
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<link href="quicklook.css"><script src="quicklook.js"></script>',
    );
    fs.writeFileSync(path.join(dir, "quicklook.js"), "onQuickLookReady");
    const current = path.join(cacheRoot, "current");
    if (fs.existsSync(current)) fs.unlinkSync(current);
    fs.symlinkSync(dir, current);
    return path.join(dir, "quicklook.css");
  }
  return { cache, base, generation };
}
test("patch is idempotent and exact restoration preserves leading/trailing unrelated edits", () => {
  const base = "original\n";
  const value = patch(base, "body{}");
  assert.equal(patch(value, "body{}"), value);
  assert.equal(strip(value), base);
  assert.equal(strip("prefix" + value + "suffix"), "prefix" + base + "suffix");
});
test("malformed, unknown and duplicate markers fail closed", () => {
  for (const v of [
    BEGIN + "x",
    END + "x",
    "/* quickcss:begin v2 */",
    patch("", "x") + patch("", "y"),
  ])
    assert.throws(() => strip(v));
});
test("apply retains original backup, makes no repeated CSS writes, preserves foreign edits on restore", (t) => {
  const { cache, base, generation } = fixture(t),
    file = generation("a");
  cache.applySnapshot(snapshot, "vault A", "1.14.4");
  const mtime = fs.statSync(file).mtimeMs;
  assert.equal(cache.reconcile().changed, false);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  fs.appendFileSync(file, "\n/* foreign change */");
  assert.equal(cache.restore(), 1);
  assert.equal(fs.readFileSync(file, "utf8"), base + "\n/* foreign change */");
  assert.equal(cache.state().enabled, false);
  const backups = fs.readdirSync(path.join(cache.stateRoot, "backups"));
  assert.equal(
    fs.readFileSync(path.join(cache.stateRoot, "backups", backups[0]), "utf8"),
    base,
  );
});
test("a second vault reconciles shared profile; replacements receive selected CSS", (t) => {
  const { cache, generation } = fixture(t);
  generation("a");
  cache.applySnapshot(
    { ...snapshot, css: "body{font-size:25px}" },
    "vault A",
    "1.14.4",
  );
  const other = new Cache(cache.root, cache.stateRoot);
  const file = generation("b");
  assert.equal(other.reconcile().changed, true);
  assert.match(fs.readFileSync(file, "utf8"), /25px/);
  assert.equal(other.state().label, "vault A");
  assert.equal(other.restore(), 2);
});
test("unsupported renderer is refused without profile activation", (t) => {
  const { cache, generation } = fixture(t);
  const file = generation("a");
  fs.writeFileSync(path.join(path.dirname(file), "index.html"), "new renderer");
  assert.throws(() => cache.applySnapshot(snapshot, "A", "2"));
  assert.equal(cache.state().enabled, false);
});
test("external symlink and resource symlink are rejected", (t) => {
  const { cache, generation } = fixture(t);
  const file = generation("a");
  fs.unlinkSync(file);
  fs.symlinkSync(cache.stateRoot, file);
  assert.throws(() => cache.current());
});
test("concurrent lock blocks writes and leaves selected state intact", (t) => {
  const { cache, generation } = fixture(t);
  generation("a");
  cache.applySnapshot(snapshot, "A", "1");
  fs.writeFileSync(path.join(cache.stateRoot, "write.lock"), "another");
  assert.throws(() =>
    cache.applySnapshot({ ...snapshot, css: "body{font-size:30px}" }, "B", "1"),
  );
  assert.equal(cache.state().label, "A");
});
test("compare before atomic write protects against intervening changes", (t) => {
  const { generation } = fixture(t),
    file = generation("a");
  assert.throws(() => atomic(file, "replacement", "old"));
  assert.match(fs.readFileSync(file, "utf8"), /font-text-size/);
});
test("restore stops auto reapply even when a corrupted block prevents removal", (t) => {
  const { cache, generation } = fixture(t),
    file = generation("a");
  cache.applySnapshot(snapshot, "A", "1");
  fs.appendFileSync(file, BEGIN);
  assert.throws(() => cache.restore());
  assert.equal(cache.state().enabled, false);
  assert.equal(cache.reconcile().enabled, false);
});
test("snapshot validation rejects invalid content before writing", (t) => {
  const { cache, generation } = fixture(t);
  generation("a");
  for (const invalid of [
    { schema: 1, css: "body{}" },
    { schema: 2, css: null },
    { schema: 2, css: "x".repeat(1000001) },
    { schema: 2, css: '@import "https://example.com";' },
    { schema: 2, css: "/* quickcss:end */" },
  ])
    assert.throws(() => cache.applySnapshot(invalid, "A", "1"));
  assert.equal(cache.state().enabled, false);
});

test("dead process locks recover, including legacy PID-only locks", (t) => {
  const { cache, generation } = fixture(t);
  generation("a");
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock"),
    kill = process.kill;
  process.kill = (pid, signal) => {
    assert.equal(pid, 2147483647);
    assert.equal(signal, 0);
    throw Object.assign(Error("gone"), { code: "ESRCH" });
  };
  try {
    for (const data of [
      JSON.stringify({ pid: 2147483647, createdAt: Date.now() }),
      "2147483647",
    ]) {
      fs.writeFileSync(lock, data);
      cache.claim("A", "A");
      assert.equal(fs.existsSync(lock), false);
      assert.equal(cache.state().owner, "A");
    }
  } finally {
    process.kill = kill;
  }
});
test("recent live process locks and permission-denied probes remain locked", (t) => {
  const { cache } = fixture(t);
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock");
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
  );
  fs.utimesSync(lock, 1, 1);
  assert.throws(() => cache.claim("A", "A"), /Another QuickCss/);
  const kill = process.kill;
  process.kill = () => {
    throw Object.assign(Error("denied"), { code: "EPERM" });
  };
  try {
    assert.throws(() => cache.claim("A", "A"), /Another QuickCss/);
  } finally {
    process.kill = kill;
  }
  assert.ok(fs.existsSync(lock));
});
test("incomplete locks get a grace period then recover; exceptions release owned lock", (t) => {
  const { cache } = fixture(t);
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock");
  fs.writeFileSync(lock, "");
  assert.throws(() => cache.claim("A", "A"), /Another QuickCss/);
  fs.utimesSync(lock, 1, 1);
  assert.throws(
    () =>
      cache.locked(() => {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        assert.equal(owner.pid, process.pid);
        assert.ok(owner.createdAt > 0);
        throw Error("operation failed");
      }),
    /operation failed/,
  );
  assert.equal(fs.existsSync(lock), false);
});
test("recovery preserves a lock replaced during the process probe", (t) => {
  const { cache } = fixture(t);
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647 }));
  const kill = process.kill;
  process.kill = (pid) => {
    if (pid === 2147483647) {
      fs.unlinkSync(lock);
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
      throw Object.assign(Error("gone"), { code: "ESRCH" });
    }
    return kill(pid, 0);
  };
  try {
    assert.throws(() => cache.claim("A", "A"), /Another QuickCss/);
    assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).pid, process.pid);
  } finally {
    process.kill = kill;
  }
});

test("expired locks recover despite a reused live PID or permission-denied process probe", (t) => {
  const { cache } = fixture(t);
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock");
  const kill = process.kill;
  process.kill = () => {
    throw Object.assign(Error("denied"), { code: "EPERM" });
  };
  try {
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, createdAt: Date.now() - 31000 }),
    );
    cache.claim("A", "A");
    assert.equal(fs.existsSync(lock), false);
    assert.equal(cache.state().owner, "A");
  } finally {
    process.kill = kill;
  }
});
test("legacy and invalid timestamps use lock modification time for expiry", (t) => {
  const { cache } = fixture(t);
  fs.mkdirSync(cache.stateRoot);
  const lock = path.join(cache.stateRoot, "write.lock");
  for (const data of [
    String(process.pid),
    JSON.stringify({ pid: process.pid, createdAt: "invalid" }),
    JSON.stringify({ pid: process.pid, createdAt: Date.now() + 60000 }),
  ]) {
    fs.writeFileSync(lock, data);
    fs.utimesSync(lock, 1, 1);
    cache.claim("A", "A");
    assert.equal(fs.existsSync(lock), false);
  }
});

test("unchanged, disabled and foreign-owner reconciliation takes no write lock", (t) => {
  const { cache, generation } = fixture(t);
  const file = generation("a");
  cache.claim("A", "A");
  cache.applySnapshot(snapshot, "A", "1", "A");
  const locked = cache.locked;
  cache.locked = () => assert.fail("unnecessary write lock");
  assert.equal(cache.reconcile("A").changed, false);
  fs.writeFileSync(file, "body{--font-text-size:16px}.markdown-rendered{}");
  assert.equal(cache.reconcile("B").skipped, true);
  cache.locked = locked;
  cache.restore("A");
  cache.locked = () => assert.fail("disabled reconciliation took a lock");
  assert.equal(cache.reconcile("A").enabled, false);
});

test("ownership changes between reconciliation and lock acquisition prevent stale repairs", (t) => {
  const { cache, generation } = fixture(t);
  generation("a");
  cache.claim("A", "A");
  cache.applySnapshot(snapshot, "A", "1", "A");
  const file = generation("b");
  const bytes = fs.readFileSync(file, "utf8");
  const locked = cache.locked.bind(cache);
  cache.locked = (operation) => {
    cache.locked = locked;
    cache.claim("B", "B", true);
    return locked(operation);
  };
  assert.equal(cache.reconcile("A").skipped, true);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
});
