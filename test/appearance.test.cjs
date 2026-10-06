const { test } = require("node:test");
const assert = require("node:assert/strict");
const { settings, evaluation, installed } = require("../src/appearance.cjs");
const { patch } = require("../src/cache.cjs");
function fixture() {
  const files = {
    "custom/themes/Test/theme.css":
      ".theme-light{color:blue}.theme-dark{color:cyan}",
    "custom/snippets/a.css": "p{color:red}",
    "custom/snippets/z.css": "p{color:green}",
  };
  const reads = [];
  const app = {
    vault: {
      configDir: "custom",
      adapter: {
        read: async (file) => {
          reads.push(file);
          if (!(file in files)) throw Error("missing: " + file);
          return files[file];
        },
      },
    },
  };
  const cache = {
    current: () => ({ source: patch("native{}", "old-capture{}") }),
  };
  return { app, cache, reads, files };
}
test("old settings migrate to follow vault, and snippet selections are stable and unique", () => {
  assert.deepEqual(settings(), { source: "vault", theme: "", snippets: [] });
  assert.deepEqual(
    settings({
      source: "fixed",
      theme: "Test",
      snippets: ["z", "a", "a", null],
    }).snippets,
    ["a", "z"],
  );
});
test("fixed source excludes current theme, classes, inline settings and previous capture", async () => {
  const { app, cache, reads } = fixture();
  const selection = settings({
    source: "fixed",
    theme: "Test",
    snippets: ["z", "a"],
  });
  const first = await evaluation(app, cache, selection, {
    cssTheme: "Active",
    enabledCssSnippets: ["missing"],
  });
  const next = await evaluation(app, cache, selection, {
    cssTheme: "Changed",
    enabledCssSnippets: [],
  });
  assert.deepEqual(first, next);
  assert.equal(first.appearance.cssTheme, "Test");
  assert.deepEqual(first.options.classes, []);
  assert.equal(first.options.inline, false);
  assert.equal(
    first.options.styles,
    "native{}\n.theme-light{color:blue}.theme-dark{color:cyan}\np{color:red}\np{color:green}",
  );
  assert.ok(reads.every((file) => !file.includes("missing")));
});
test("follow adds only snippets not already enabled; missing selection blocks instead of silently dropping", async () => {
  const { app, cache, reads } = fixture();
  const result = await evaluation(
    app,
    cache,
    settings({ snippets: ["z", "a"] }),
    { cssTheme: "Active", enabledCssSnippets: ["a"] },
  );
  assert.deepEqual(reads, ["custom/snippets/z.css"]);
  assert.deepEqual(result.appearance.enabledCssSnippets, ["a", "z"]);
  assert.deepEqual(result.options, { extraStyles: "p{color:green}" });
  await assert.rejects(
    evaluation(app, cache, settings({ snippets: ["missing"] }), {}),
    /missing/,
  );
  await assert.rejects(
    evaluation(
      app,
      cache,
      settings({ source: "fixed", theme: "../escape" }),
      {},
    ),
    /Invalid/,
  );
});
test("installed files respect custom config directory and filter CSS files", async () => {
  const adapter = {
    list: async (dir) =>
      dir.endsWith("themes")
        ? { folders: ["custom/themes/Test"], files: [] }
        : {
            folders: [],
            files: [
              "custom/snippets/z.css",
              "custom/snippets/a.css",
              "custom/snippets/ignored.txt",
            ],
          },
  };
  assert.deepEqual(await installed(adapter, "custom"), {
    themes: ["Test"],
    snippets: ["a", "z"],
  });
});

test("selected snippet disk changes notify without watching plugin directories; close stops monitoring", async (t) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const { watchFiles } = require("../src/appearance.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quickcss-appearance-"));
  const config = path.join(root, "custom");
  fs.mkdirSync(path.join(config, "snippets"), { recursive: true });
  fs.mkdirSync(path.join(config, "plugins"));
  let changes = 0;
  const errors = [];
  const stop = watchFiles(
    { vault: { configDir: "custom", adapter: { getBasePath: () => root } } },
    () => changes++,
    (error) => errors.push(error),
  );
  t.after(() => {
    stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(config, "snippets", "extra.css"), "p{color:red}");
  const deadline = Date.now() + 3000;
  while (!changes) {
    assert.ok(Date.now() < deadline, "snippet event did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stop();
  const count = changes;
  fs.writeFileSync(path.join(config, "snippets", "extra.css"), "p{color:blue}");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(changes, count);
  assert.deepEqual(errors, []);
});
