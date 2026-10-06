const fs = require("node:fs");
const path = require("node:path");

// Watch directories so atomic file replacements do not leave a watch attached
// to an old inode. Parent watches also let us follow recreated cache directories.
class CacheWatcher {
  constructor(cache, options) {
    this.cache = cache;
    this.options = options;
    this.watchers = new Map();
    this.timer = null;
    this.closed = false;
    this.error = null;
  }

  refresh() {
    if (this.closed) return;
    this.error = null;
    const desired = new Map();
    const add = (directory, accepts) => {
      const requested = path.resolve(directory);
      let existing = requested;
      let stat;
      while (true) {
        try {
          stat = fs.statSync(existing);
          if (!stat.isDirectory()) throw Error("Not a directory: " + existing);
          break;
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
          const parent = path.dirname(existing);
          if (parent === existing) throw error;
          existing = parent;
        }
      }
      const missingChild = path
        .relative(existing, requested)
        .split(path.sep)[0];
      const filter = missingChild ? (name) => name === missingChild : accepts;
      const entry = desired.get(existing) || { stat, filters: [] };
      entry.filters.push(filter);
      desired.set(existing, entry);
    };

    try {
      for (const directory of [this.cache.root, this.cache.stateRoot]) {
        add(
          path.dirname(directory),
          (name) => name === path.basename(directory),
        );
      }
      add(
        this.cache.root,
        (name) => name === "current" || /^[a-f0-9]{64}$/.test(name),
      );
      add(this.cache.stateRoot, (name) => name === "profile.json");
      try {
        const root = fs.realpathSync(this.cache.root);
        const current = fs.realpathSync(path.join(root, "current"));
        if (
          path.dirname(current) === root &&
          /^[a-f0-9]{64}$/.test(path.basename(current))
        ) {
          add(current, (name) =>
            ["quicklook.css", "quicklook.js", "index.html"].includes(name),
          );
        }
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      }
    } catch (error) {
      this.report(error);
    }

    for (const [directory, entry] of this.watchers) {
      const next = desired.get(directory);
      if (
        !next ||
        next.stat.ino !== entry.stat.ino ||
        next.stat.dev !== entry.stat.dev
      ) {
        entry.watcher.close();
        this.watchers.delete(directory);
      }
    }
    let attached = false;
    for (const [directory, next] of desired) {
      const previous = this.watchers.get(directory);
      if (previous) {
        previous.filters = next.filters;
        continue;
      }
      const entry = { ...next };
      try {
        entry.watcher = fs.watch(
          directory,
          { persistent: false },
          (_event, filename) => {
            const name = filename?.toString();
            if (
              !name ||
              name === path.basename(directory) ||
              entry.filters.some((accepts) => accepts(name))
            ) {
              this.schedule();
            }
          },
        );
        entry.watcher.on("error", (error) => {
          if (this.closed || this.watchers.get(directory) !== entry) return;
          entry.watcher.close();
          this.watchers.delete(directory);
          this.report(error);
        });
        this.watchers.set(directory, entry);
        attached = true;
      } catch (error) {
        this.report(error);
      }
    }
    // Native watch registration can settle asynchronously. One check after
    // attaching watches covers changes in that gap; it does not repeat at idle.
    if (attached) this.schedule();
  }

  report(error) {
    this.error = error;
    this.options.error?.(error);
  }

  fingerprint() {
    // macOS may deliver duplicate or directory-only notifications long after
    // registration. Compare relevant resource identity, not directory mtime.
    const identify = (file) => {
      try {
        const stat = fs.statSync(file);
        return [
          stat.dev,
          stat.ino,
          stat.isDirectory() ? null : stat.mtimeMs,
          stat.isDirectory() ? null : stat.ctimeMs,
          stat.isDirectory() ? null : stat.size,
        ];
      } catch (error) {
        return error.code;
      }
    };
    const current = path.join(this.cache.root, "current");
    return JSON.stringify([
      ...[
        this.cache.root,
        this.cache.stateRoot,
        current,
        this.cache.stateFile,
      ].map(identify),
      ...["quicklook.css", "quicklook.js", "index.html"].map((file) =>
        identify(path.join(current, file)),
      ),
    ]);
  }

  schedule() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      this.refresh();
      const fingerprint = this.fingerprint();
      if (fingerprint === this.lastFingerprint) return;
      this.lastFingerprint = fingerprint;
      this.options.change();
    }, this.options.delay ?? 100);
    this.timer.unref?.();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    for (const entry of this.watchers.values()) entry.watcher.close();
    this.watchers.clear();
  }
}

module.exports = { CacheWatcher };
