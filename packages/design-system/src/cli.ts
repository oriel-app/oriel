// `pnpm -s ds <page>`: a guide page as plain text, with its live tables
// filled in from the Oriel checkout. `pnpm -s ds` lists the pages.
//
//   pnpm -s ds components/button
//   pnpm -s ds foundations/colour
//
// `pnpm -s ds where <name> [file]`: the lines a name the guide cites is on in
// the checkout today, in one file or in all of them.
//
//   pnpm -s ds where .connect-actions
//   pnpm -s ds where FolderStep packages/web/src/connect-steps.tsx
import { pages } from "./guide.ts";
import { refPath } from "./md.ts";
import { plainText } from "./render.ts";
import { where, whereAnywhere } from "./where.ts";

const [first = "", ...rest] = process.argv.slice(2);

if (first === "where") {
  const [name, file] = rest;
  if (name === undefined) {
    console.error("Say a name: pnpm -s ds where .connect-actions [window.css]");
    process.exitCode = 1;
  } else {
    const found = file === undefined ? whereAnywhere(name) : where(refPath(file), name);
    if (found === null) console.error(`No ${file} in the Oriel checkout.`);
    else if (found.length === 0) console.error(`No ${name} in ${file ?? "the checkout"}.`);
    for (const f of found ?? []) console.log(`${f.file}:${f.line}  ${f.text}`);
    process.exitCode = found?.length ? 0 : 1;
  }
} else {
  const asked = first.replace(/^\/|\.md$/g, "");
  const found = pages().find((p) => p.url === `/${asked}` || p.slug === asked);
  if (found) process.stdout.write(plainText(found));
  else {
    if (asked) console.error(`No page called ${asked}.`);
    for (const p of pages()) console.log(`${p.url.slice(1).padEnd(34)} ${p.title}`);
    process.exitCode = asked ? 1 : 0;
  }
}
