const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { inlineMask, validSVG, safeSnapshot } = require("../src/assets.cjs");
const { declarations } = require("../src/capture.cjs");
const simple =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="black" d="M2 10 L8 16 L18 4 Z"/></svg>';
function url(svg) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}
test("inline geometry masks preserve the exact path and are encoded for CSS", () => {
  assert.equal(validSVG(simple), true);
  const mask = inlineMask(url(simple));
  assert.ok(mask);
  assert.ok(safeSnapshot("input:after{mask-image:" + mask + ";}"));
  assert.equal(inlineMask(mask), mask);
  assert.ok(
    inlineMask(
      "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M0 0L1 1'/%3e%3c/svg%3e\")",
    ),
  );
  const css = declarations({ getPropertyValue: () => url(simple) }, [
    "-webkit-mask-image",
  ]);
  assert.match(css, /-webkit-mask-image: url/);
  assert.ok(decodeURIComponent(mask).includes("M2 10 L8 16 L18 4 Z"));
});
test("SVG export rejects executable, referenced, embedded and external content", () => {
  for (const bad of [
    "<svg><script>run()</script></svg>",
    '<svg onload="run()"/>',
    "<svg><foreignObject/></svg>",
    '<svg><image href="https://example.com"/></svg>',
    '<svg><use href="#x"/></svg>',
    '<svg style="fill:red"/>',
    "<!DOCTYPE svg><svg/>",
    '<svg><path fill="url(#x)"/></svg>',
    "<svg>&xx;</svg>",
    '<svg><path d="M0 0"/></g>',
  ]) {
    assert.equal(validSVG(bad), false, bad);
    assert.equal(inlineMask(url(bad)), null, bad);
    assert.equal(safeSnapshot("mask-image:" + url(bad)), false, bad);
  }
  for (const external of [
    'url("https://example.com/a.svg")',
    'url("file:///etc/passwd")',
    'url("data:text/html,x")',
    'url("data:image/svg+xml;base64,eA==")',
  ])
    assert.equal(inlineMask(external), null);
  assert.equal(
    safeSnapshot(
      "x{mask-image:" +
        url(simple) +
        ';background:url("https://example.com/x")}',
    ),
    false,
  );
  assert.equal(safeSnapshot('@import "x";'), false);
});
