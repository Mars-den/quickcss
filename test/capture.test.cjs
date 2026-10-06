const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { serializeMode, safeValue, loadedCSS } = require("../src/capture.cjs");
const { Cache } = require("../src/cache.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function style(values) {
  const names = Object.keys(values);
  names.getPropertyValue = (name) => values[name] || "";
  return names;
}
test("snapshot exports scheme-specific scalar reading styles, including class-driven results", () => {
  const body = style({
      "--background-primary": "rgb(10, 20, 30)",
      "--font-text-size": "21px",
      "--sidebar-width": "200px",
      color: "rgb(200, 210, 220)",
    }),
    view = style({ "--line-height-normal": "1.7" }),
    heading = style({
      "font-family": "Georgia",
      "font-size": "32px",
      color: "rgb(1, 2, 3)",
      "background-image": 'url("private-file.png")',
    });
  const out = serializeMode("dark", body, view, [
    [".markdown-rendered h1", heading],
  ]);
  assert.match(out, /body.theme-dark .markdown-rendered h1/);
  assert.match(out, /font-family: Georgia/);
  assert.match(out, /--font-text-size: 21px/);
  assert.match(out, /--line-height-normal: 1.7/);
  assert.doesNotMatch(out, /sidebar|private-file|url\(/);
  assert.throws(() => serializeMode("anything", body, view, []));
});
test("unsafe computed values are dropped and CSS import/font rules are excluded during evaluation", () => {
  assert.equal(safeValue('url("https://example.com")'), false);
  assert.equal(safeValue("red;}body{display:none"), false);
  assert.equal(safeValue("linear-gradient(red, blue)"), true);
  const out = loadedCSS({
    styleSheets: [
      {
        cssRules: [
          { type: 3, cssText: '@import "x"' },
          { type: 5, cssText: "@font-face{}" },
          { type: 1, cssText: "body{color:red}" },
        ],
      },
      { disabled: true, cssRules: [{ type: 1, cssText: "disabled{}" }] },
    ],
    adoptedStyleSheets: [],
  });
  assert.equal(out.css, "body{color:red}");
});
test("captured profile persists and reconciles without the theme or Style Settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quickcss-capture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, "cache");
  fs.mkdirSync(cacheRoot);
  const dir = path.join(cacheRoot, "a".repeat(64));
  fs.mkdirSync(dir);
  fs.symlinkSync(dir, path.join(cacheRoot, "current"));
  const file = path.join(dir, "quicklook.css");
  const base = "body{--font-text-size:16px}.markdown-rendered{}";
  fs.writeFileSync(file, base);
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<link href="quicklook.css"><script src="quicklook.js"></script>',
  );
  fs.writeFileSync(path.join(dir, "quicklook.js"), "onQuickLookReady");
  const c = new Cache(cacheRoot, path.join(root, "state")),
    snapshot = {
      schema: 2,
      css: "body.theme-dark {color: purple}",
      theme: "Test",
    };
  c.applySnapshot(snapshot, "Test", "1.14.4");
  assert.equal(c.state().snapshot.theme, "Test");
  fs.writeFileSync(file, base);
  assert.equal(c.reconcile().changed, true);
  assert.match(fs.readFileSync(file, "utf8"), /color: purple/);
  c.restore();
  assert.equal(c.state().enabled, false);
  assert.equal(fs.readFileSync(file, "utf8"), base);
  assert.throws(() =>
    c.applySnapshot({ ...snapshot, css: '@import "x"' }, "Test", "1"),
  );
});
test("table capture retains responsive layout and samples interior/edge cells separately", () => {
  const { TABLE_TARGETS, TABLE_LAYOUT } = require("../src/capture.cjs");
  assert.ok(TABLE_LAYOUT.includes("min-width"));
  assert.ok(TABLE_LAYOUT.includes("border-collapse"));
  assert.ok(TABLE_LAYOUT.includes("border-spacing"));
  const interior = TABLE_TARGETS.find(
    ([selector]) => selector === ".markdown-rendered table td",
  );
  assert.match(interior[1], /nth-child\(2\).*nth-child\(2\)/);
  const corner = TABLE_TARGETS.find(
    ([selector, query, props]) =>
      selector.includes("tbody tr:last-child>td:last-child") &&
      props.length === 1,
  );
  assert.deepEqual(corner[2], ["border-bottom-right-radius"]);
  const out = serializeMode("dark", style({}), style({}), [
    [
      ".markdown-rendered table",
      style({
        "min-width": "100%",
        "border-collapse": "separate",
        "border-spacing": "0px",
      }),
      TABLE_LAYOUT,
    ],
  ]);
  assert.match(out, /min-width: 100%/);
  assert.doesNotMatch(out, /(?<!-)width:/);
});
test("quote decoration uses responsive top/bottom anchoring rather than frozen height", () => {
  const { quoteDecoration } = require("../src/capture.cjs");
  const owner = style({ position: "relative" }),
    before = style({
      content: '""',
      position: "absolute",
      top: "16px",
      bottom: "16px",
      height: "28px",
      width: "2px",
    });
  const out = quoteDecoration(
    { getComputedStyle: (_el, pseudo) => (pseudo ? before : owner) },
    { querySelector: () => ({}) },
  );
  assert.equal(out[1][0], ".markdown-rendered blockquote::before");
  assert.ok(out[1][2].includes("content"));
  assert.ok(!out[1][2].includes("height"));
  assert.match(
    serializeMode("dark", style({}), style({}), out),
    /position: relative/,
  );
});
test("each preview scheme evaluates its own prefers-color-scheme rules", () => {
  const { schemeCSS } = require("../src/capture.cjs");
  const css =
    "@media (prefers-color-scheme: dark){body{color:white}} @media (prefers-color-scheme: light){body{color:black}}";
  const light = schemeCSS(css, "light"),
    dark = schemeCSS(css, "dark");
  assert.match(light, /10000000px\)\{body\{color:white/);
  assert.match(light, /0px\)\{body\{color:black/);
  assert.match(dark, /0px\)\{body\{color:white/);
});

test("opaque canvas and portable colors replace transparent source backgrounds", () => {
  const source = style({
    "--background-primary": "oklch(0.2 0 0)",
    "--font-text": "Georgia",
    color: "oklch(0.81 0 0)",
    "background-color": "rgba(0, 0, 0, 0)",
  });
  const resolve = (v) =>
    ({
      "oklch(0.2 0 0)": "rgb(22, 22, 22)",
      "oklch(0.81 0 0)": "rgb(193, 193, 193)",
    })[v] || v;
  const out = serializeMode(
    "dark",
    source,
    style({}),
    [[".markdown-rendered p", source]],
    { resolve, background: "rgb(22, 22, 22)" },
  );
  assert.match(out, /--quickcss-canvas-background: rgb\(22, 22, 22\)/);
  assert.match(out, /--background-primary: rgb\(22, 22, 22\)/);
  assert.match(out, /--font-text: Georgia/);
  assert.doesNotMatch(out, /oklch/);
  assert.match(out, /color: rgb\(193, 193, 193\)/);
});
test("reading canvas composites ancestor paint over the theme primary fallback", () => {
  const { readingBackground } = require("../src/capture.cjs");
  const root = { parentElement: null },
    body = { parentElement: root },
    view = { parentElement: body };
  const styles = new Map([
    [root, { backgroundColor: "rgba(0, 0, 0, 0)" }],
    [body, { backgroundColor: "rgb(40, 40, 40)" }],
    [
      view,
      {
        backgroundColor: "rgba(100, 100, 100, 0.5)",
        getPropertyValue: () => "rgb(22, 22, 22)",
      },
    ],
  ]);
  assert.equal(
    readingBackground(
      { getComputedStyle: (el) => styles.get(el) },
      view,
      (v) => v,
      "dark",
    ),
    "rgb(70, 70, 70)",
  );
});
test("task capture includes horizontal spacing and marker placement without freezing list width", () => {
  const { taskStyles } = require("../src/capture.cjs"),
    mock = style({ content: '""', top: "0px", "margin-inline-end": "4px" });
  const result = taskStyles(
    { getComputedStyle: () => mock },
    { querySelector: () => ({}) },
  );
  const input = result.find(([s]) =>
    s.endsWith("input.task-list-item-checkbox:checked"),
  );
  assert.ok(input[2].includes("margin-inline-start"));
  assert.ok(input[2].includes("margin-inline-end"));
  assert.ok(input[2].includes("vertical-align"));
  assert.ok(input[2].includes("width"));
  assert.ok(!result[0][2].includes("width"));
  assert.ok(result.some(([s]) => s.endsWith("::after")));
});

test("cancelling an iframe evaluation removes it immediately and rejects before the five-second timeout", async () => {
  const { frame } = require("../src/capture.cjs");
  let removed = 0,
    appended = 0;
  const doc = {
    body: { append: () => appended++ },
    createElement: () => ({
      style: {},
      setAttribute() {},
      remove() {
        removed++;
      },
    }),
  };
  const controller = new AbortController(),
    start = performance.now();
  const pending = frame(doc, "dark", [], "body{}", doc.body, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(appended, 1);
  assert.equal(removed, 1);
  assert.ok(performance.now() - start < 100);
  const already = new AbortController();
  already.abort();
  await assert.rejects(
    frame(doc, "dark", [], "body{}", doc.body, { signal: already.signal }),
    { name: "AbortError" },
  );
  assert.equal(appended, 1);
});

test("context capture separates heading and callout emphasis and gives nested lists sufficient specificity", () => {
  const { CONTEXT_TARGETS, SAMPLE } = require("../src/capture.cjs");
  assert.match(SAMPLE, /<h1>[^<]+<strong>/);
  assert.match(SAMPLE, /A deeper item/);
  for (const level of [1, 2, 3, 4, 5, 6])
    for (const tag of ["strong", "em"])
      assert.ok(
        CONTEXT_TARGETS.some(
          ([selector]) => selector === `.markdown-rendered h${level} ${tag}`,
        ),
      );
  for (const tag of ["strong", "em"])
    assert.ok(
      CONTEXT_TARGETS.some(
        ([selector]) =>
          selector ===
          `.markdown-rendered .callout[data-callout="note"] .callout-content ${tag}`,
      ),
    );
  assert.ok(
    CONTEXT_TARGETS.some(
      ([selector]) =>
        selector ===
        ".markdown-rendered ul:not(.contains-task-list) ul:not(.contains-task-list) ul:not(.contains-task-list)",
    ),
  );
});
