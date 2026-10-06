const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { css, validate } = require("./profile.cjs");
const { safeSnapshot } = require("./assets.cjs");
const BEGIN = "\n/* quickcss:begin v1 */\n",
  END = "\n/* quickcss:end v1 */\n";
function strip(sourceCSS) {
  const beginIndex = sourceCSS.indexOf(BEGIN),
    endIndex = sourceCSS.indexOf(END);
  if (beginIndex < 0 && endIndex < 0) {
    if (
      sourceCSS.includes("quickcss:begin") ||
      sourceCSS.includes("quickcss:end")
    )
      throw Error("Unrecognized QuickCss markers; manual review required");
    return sourceCSS;
  }
  if (
    beginIndex < 0 ||
    endIndex < beginIndex ||
    sourceCSS.indexOf(BEGIN, beginIndex + 1) >= 0 ||
    sourceCSS.indexOf(END, endIndex + 1) >= 0
  )
    throw Error("Damaged or duplicate QuickCss block; manual review required");
  return (
    sourceCSS.slice(0, beginIndex) + sourceCSS.slice(endIndex + END.length)
  );
}
function patch(sourceCSS, cssText) {
  return strip(sourceCSS) + BEGIN + cssText + END;
}
function atomic(filePath, value, expected) {
  if (expected !== undefined && fs.readFileSync(filePath, "utf8") !== expected)
    throw Error("Resource changed during operation; retry");
  const mode = fs.existsSync(filePath)
    ? fs.statSync(filePath).mode & 0o777
    : 0o600;
  const temporaryPath = filePath + ".quickcss-" + crypto.randomUUID();
  try {
    const fileDescriptor = fs.openSync(temporaryPath, "wx", mode);
    try {
      fs.writeFileSync(fileDescriptor, value);
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    if (
      expected !== undefined &&
      fs.readFileSync(filePath, "utf8") !== expected
    )
      throw Error("Resource changed during operation; retry");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}
class Cache {
  constructor(
    root = path.join(
      os.homedir(),
      "Library/Application Support/obsidian/quicklook",
    ),
    stateRoot = path.join(os.homedir(), "Library/Application Support/QuickCss"),
  ) {
    this.root = root;
    this.stateRoot = stateRoot;
    this.stateFile = path.join(stateRoot, "profile.json");
  }
  state() {
    if (!fs.existsSync(this.stateFile)) return { schema: 1, enabled: false };
    const sharedState = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    if (
      ![1, 2].includes(sharedState.schema) ||
      typeof sharedState.enabled !== "boolean" ||
      (sharedState.enabled && typeof sharedState.css !== "string")
    )
      throw Error("Unsupported shared profile");
    return sharedState;
  }
  locked(operation) {
    fs.mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.stateRoot, "write.lock");
    let fileDescriptor;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fileDescriptor = fs.openSync(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      let previousLockStat, lockContents;
      try {
        previousLockStat = fs.lstatSync(lockPath);
        if (!previousLockStat.isFile())
          throw Error("Unsupported QuickCss lock");
        lockContents = fs.readFileSync(lockPath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      let lockMetadata;
      try {
        lockMetadata = JSON.parse(lockContents);
      } catch {}
      const pid =
        typeof lockMetadata === "number" ? lockMetadata : lockMetadata?.pid;
      const now = Date.now();
      const createdAt =
        Number.isFinite(lockMetadata?.createdAt) &&
        lockMetadata.createdAt > 0 &&
        lockMetadata.createdAt <= now
          ? lockMetadata.createdAt
          : previousLockStat.mtimeMs;
      // PID reuse after a reboot must not leave a lock permanently active.
      // Writes are synchronous; thirty seconds is the maximum lock lifetime.
      let stale = now - createdAt >= 30000;
      if (!stale && Number.isInteger(pid) && pid > 0 && pid <= 2147483647) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") stale = true;
          else if (error.code !== "EPERM") throw error;
        }
      }
      // Incomplete metadata may belong to a writer that just created the file.
      else if (
        !stale &&
        (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647)
      ) {
        stale = now - previousLockStat.mtimeMs > 10000;
      }
      if (!stale)
        throw Error("Another QuickCss instance is writing; try again shortly");
      try {
        const currentLockStat = fs.lstatSync(lockPath);
        if (
          currentLockStat.dev === previousLockStat.dev &&
          currentLockStat.ino === previousLockStat.ino &&
          currentLockStat.mtimeMs === previousLockStat.mtimeMs &&
          fs.readFileSync(lockPath, "utf8") === lockContents
        )
          fs.unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (fileDescriptor === undefined)
      throw Error("QuickCss lock changed during recovery; try again shortly");
    const ownedLockStat = fs.fstatSync(fileDescriptor);
    try {
      fs.writeFileSync(
        fileDescriptor,
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      );
      return operation();
    } finally {
      fs.closeSync(fileDescriptor);
      try {
        const currentLockStat = fs.lstatSync(lockPath);
        if (
          currentLockStat.dev === ownedLockStat.dev &&
          currentLockStat.ino === ownedLockStat.ino
        )
          fs.unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  current() {
    const cacheDirectory = fs.realpathSync(path.join(this.root, "current"));
    if (
      path.dirname(cacheDirectory) !== fs.realpathSync(this.root) ||
      !/^[a-f0-9]{64}$/.test(path.basename(cacheDirectory))
    )
      throw Error("Unsupported Quick Look cache location");
    const filePath = path.join(cacheDirectory, "quicklook.css");
    for (const fileName of ["quicklook.css", "quicklook.js", "index.html"])
      if (!fs.lstatSync(path.join(cacheDirectory, fileName)).isFile())
        throw Error("Unsupported Quick Look resource");
    const rendererHTML = fs.readFileSync(
        path.join(cacheDirectory, "index.html"),
        "utf8",
      ),
      rendererJavaScript = fs.readFileSync(
        path.join(cacheDirectory, "quicklook.js"),
        "utf8",
      ),
      sourceCSS = fs.readFileSync(filePath, "utf8");
    if (
      !rendererHTML.includes('href="quicklook.css"') ||
      !rendererHTML.includes('src="quicklook.js"') ||
      !rendererJavaScript.includes("onQuickLookReady") ||
      !sourceCSS.includes("--font-text-size") ||
      !sourceCSS.includes(".markdown-rendered")
    )
      throw Error("Unsupported Quick Look renderer; nothing patched");
    return { dir: cacheDirectory, file: filePath, source: sourceCSS };
  }
  writeCurrent(cssText) {
    const {
      dir: cacheDirectory,
      file: filePath,
      source: sourceCSS,
    } = this.current();
    const updatedCSS = patch(sourceCSS, cssText);
    if (updatedCSS === sourceCSS)
      return { changed: false, cache: path.basename(cacheDirectory) };
    const backups = path.join(this.stateRoot, "backups");
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const baseCSS = strip(sourceCSS),
      backupHash = crypto.createHash("sha256").update(baseCSS).digest("hex"),
      backup = path.join(backups, backupHash + ".css");
    if (!fs.existsSync(backup)) atomic(backup, baseCSS);
    atomic(filePath, updatedCSS, sourceCSS);
    return { changed: true, cache: path.basename(cacheDirectory) };
  }
  apply(profile, label, version) {
    const validatedProfile = validate(profile),
      cssText = css(validatedProfile);
    return this.locked(() => {
      this.current();
      atomic(
        this.stateFile,
        JSON.stringify(
          {
            schema: 1,
            enabled: true,
            profile: validatedProfile,
            css: cssText,
            label,
            version,
            appliedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return this.writeCurrent(cssText);
    });
  }
  applySnapshot(snapshot, label, version, ownerId) {
    if (
      snapshot?.schema !== 2 ||
      typeof snapshot.css !== "string" ||
      snapshot.css.length > 1000000 ||
      !safeSnapshot(snapshot.css)
    )
      throw Error("Invalid captured appearance");
    return this.locked(() => {
      const previousState = this.state();
      if (ownerId && previousState.owner !== ownerId) return { skipped: true };
      this.current();
      if (
        previousState.enabled &&
        previousState.css === snapshot.css &&
        previousState.owner === ownerId &&
        previousState.label === label &&
        previousState.version === version
      )
        return this.writeCurrent(snapshot.css);
      atomic(
        this.stateFile,
        JSON.stringify(
          {
            schema: 2,
            owner: ownerId || previousState.owner,
            enabled: true,
            snapshot,
            css: snapshot.css,
            label,
            version,
            appliedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return this.writeCurrent(snapshot.css);
    });
  }
  claim(ownerId, label, force = false) {
    return this.locked(() => {
      const sharedState = this.state();
      if (sharedState.owner && sharedState.owner !== ownerId && !force)
        return false;
      atomic(
        this.stateFile,
        JSON.stringify(
          { ...sharedState, owner: ownerId, ownerLabel: label },
          null,
          2,
        ),
      );
      return true;
    });
  }
  reconcile() {
    return this.locked(() => {
      const sharedState = this.state();
      if (!sharedState.enabled) return { enabled: false };
      return {
        ...this.writeCurrent(sharedState.css),
        enabled: true,
        label: sharedState.label,
        version: sharedState.version,
      };
    });
  }
  restore(ownerId) {
    return this.locked(() => {
      const sharedState = this.state();
      if (ownerId && sharedState.owner !== ownerId) return 0;
      atomic(
        this.stateFile,
        JSON.stringify({ ...sharedState, enabled: false }, null, 2),
      );
      let restoredCount = 0;
      if (fs.existsSync(this.root))
        for (const fileName of fs.readdirSync(this.root)) {
          if (!/^[a-f0-9]{64}$/.test(fileName)) continue;
          const cacheDirectory = path.join(this.root, fileName);
          if (!fs.lstatSync(cacheDirectory).isDirectory()) continue;
          const filePath = path.join(cacheDirectory, "quicklook.css");
          if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile())
            continue;
          const sourceCSS = fs.readFileSync(filePath, "utf8"),
            updatedCSS = strip(sourceCSS);
          if (updatedCSS !== sourceCSS) {
            atomic(filePath, updatedCSS, sourceCSS);
            restoredCount++;
          }
        }
      return restoredCount;
    });
  }
}
module.exports = { Cache, strip, patch, atomic, BEGIN, END };
