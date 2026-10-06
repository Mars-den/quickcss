const path = require("node:path");
const { buildSync } = require("esbuild");
const captureBundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/capture.cjs")],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "QuickCapture",
  write: false,
}).outputFiles[0].text;
const assert = require("node:assert/strict");
const { chromium, webkit } = require(
  process.env.QUICKCSS_PLAYWRIGHT || "playwright",
);
(async () => {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        "<style>body{color:red}body.active h1{color:red}</style>",
      );
      await page.addScriptTag({ content: captureBundle });
      const result = await page.evaluate(async () => {
        const css = `body{--font-text-size:16px;font-size:16px;color:black}.markdown-rendered{color:black}
        body.theme-dark{color:white;background:#222}body.theme-light{background:#fff}
        h1{font-size:32px}h1 strong{color:blue;font-weight:900}h1 em{color:purple}
        ul{list-style-type:disc}ul ul{list-style-type:circle}ul ul ul{list-style-type:square}
        ol{list-style-type:decimal}ol ol{list-style-type:lower-alpha}ol ol ol{list-style-type:lower-roman}
        .callout[data-callout=note] .callout-content strong{color:green}
        .callout[data-callout=warning] .callout-content strong{color:orange}`;
        const snapshot = await QuickCapture.capture(
          document,
          { cssTheme: "Test" },
          { styles: css, classes: [], inline: false },
        );
        const check = async (mode, styles) => {
          const iframe = await QuickCapture.frame(document, mode, [], styles);
          try {
            const d = iframe.contentDocument;
            const prop = (s, p) =>
              iframe.contentWindow
                .getComputedStyle(d.querySelector(s))
                .getPropertyValue(p);
            return {
              color: prop("body", "color"),
              paragraphBold: prop("p strong", "color"),
              rootNumber: prop("ol > li", "list-style-type"),
              heading: prop("h1 strong", "color"),
              italic: prop("h1 em", "color"),
              nested: prop("ul ul", "list-style-type"),
              deep: prop("ul ul ul", "list-style-type"),
              number: prop("ol ol", "list-style-type"),
              deepNumber: prop("ol ol ol", "list-style-type"),
              note: prop(
                "[data-callout=note] .callout-content strong",
                "color",
              ),
              warning: prop(
                "[data-callout=warning] .callout-content strong",
                "color",
              ),
            };
          } finally {
            iframe.remove();
          }
        };
        const results = [];
        for (const mode of ["light", "dark"])
          results.push({
            mode,
            before: await check(mode, css),
            after: await check(mode, snapshot.css),
          });
        document.body.className = "active";
        document.body.style.color = "pink";
        document.querySelector("style").textContent =
          "body{color:magenta}h1{color:orange}";
        const stable = await QuickCapture.capture(
          document,
          { cssTheme: "Test" },
          { styles: css, classes: [], inline: false },
        );
        return {
          results,
          stable: stable.css === snapshot.css,
          css: snapshot.css,
        };
      });
      assert.equal(result.stable, true);
      for (const row of result.results) assert.deepEqual(row.after, row.before);
      console.log(
        `${name}: light/dark contextual round trips and fixed-source isolation passed`,
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
