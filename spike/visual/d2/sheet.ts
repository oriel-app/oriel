// Image tools for the spike, drawn by Chrome: `crop <png> <x> <y> <w> <h> <out>`
// cuts a piece out at the image's own pixels; `sheet <out> <columns> <tile
// width> <png>...` lays images out in a grid, each under its file's name.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";

const [command, ...args] = process.argv.slice(2);
const url = (file: string) => pathToFileURL(resolve(file)).href;
// A page in a file of its own, so it may show files beside it.
const show = async (page: Page, html: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "sheet-")), "page.html");
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
};
const browser = await chromium.launch({ channel: "chrome" });
try {
  if (command === "crop") {
    const [src, x, y, w, h, out] = args as [string, string, string, string, string, string];
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    await show(page, 
      `<body style="margin:0;overflow:hidden"><img src="${url(src)}" style="display:block;margin:-${y}px 0 0 -${x}px"></body>`,
    );
    writeFileSync(out, await page.screenshot());
  } else {
    const [out, columns, tile, ...files] = args as [string, string, string, ...string[]];
    const page = await browser.newPage({ viewport: { width: +columns * (+tile + 16) + 16, height: 600 } });
    await show(page, 
      `<body style="margin:0;padding:16px;background:#d8d8d4;font:13px system-ui;display:grid;grid-template-columns:repeat(${columns},${tile}px);gap:16px;align-items:start">` +
        files
          .map(
            (file) =>
              `<figure style="margin:0"><figcaption style="margin-bottom:4px;color:#333">${basename(file, ".png")}</figcaption><img src="${url(file)}" style="width:${tile}px;display:block;box-shadow:0 0 0 1px #0002"></figure>`,
          )
          .join("") +
        `</body>`,
    );
    writeFileSync(out, await page.screenshot({ fullPage: true }));
  }
} finally {
  await browser.close();
}
