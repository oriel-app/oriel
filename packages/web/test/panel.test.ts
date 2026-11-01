// The panel beside the page: which item is open lives in the address, a
// plain click opens it and a Cmd/Ctrl or middle click goes to the source, it
// reads its item when it opens, and says when that read has fallen behind.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { clickTo, samePage, withItem } from "../src/nav.ts";
import { behind, type PanelModel } from "../src/panel.ts";
import { init, type Model, update } from "../src/root.ts";
import { parseRoute, type Route, routeUrl } from "../src/route.ts";
import type { ItemPanelView } from "../src/view.ts";

const thread = "01JBZ0000000000000000000T1";
const item = "jira:SYN-88";

const click = (button: number, keys: Partial<Record<"meta" | "ctrl" | "shift" | "alt", true>>) => ({
  button,
  metaKey: keys.meta ?? false,
  ctrlKey: keys.ctrl ?? false,
  shiftKey: keys.shift ?? false,
  altKey: keys.alt ?? false,
});

test("a plain click stays in the page; Cmd, Ctrl, Shift or a middle click goes to a new tab", () => {
  assert.equal(clickTo(click(0, {})), "page");
  assert.equal(clickTo(click(0, { meta: true })), "new-tab");
  assert.equal(clickTo(click(0, { ctrl: true })), "new-tab");
  assert.equal(clickTo(click(0, { shift: true })), "new-tab");
  assert.equal(clickTo(click(1, {})), "new-tab");
  // Alt saves the link, and a right click opens the browser's menu.
  assert.equal(clickTo(click(0, { alt: true })), "browser");
  assert.equal(clickTo(click(2, {})), "browser");
});

test("the open item is part of every page's address but a review link's", () => {
  const routes: Route[] = [
    { page: "window", grouping: "assignee", addTo: null, item },
    {
      page: "workstream",
      id: "01JBZ0000000000000000000G1",
      item: "slack:C0FW1WEATHR-1788444000.000100",
    },
    { page: "thread", id: thread, item },
    { page: "done", tab: "dropped", number: 2, item: "folder:abc123" },
    { page: "new-thread", item },
  ];
  for (const route of routes) {
    const url = new URL(routeUrl(route), "http://127.0.0.1:4310");
    assert.deepEqual(parseRoute(url.pathname, url.search), route, url.href);
  }
  assert.equal(
    routeUrl({ page: "thread", id: thread, item }),
    `/threads/${thread}?item=jira%3ASYN-88`,
  );
  assert.deepEqual(parseRoute("/review/abc", `?item=${item}`), { page: "review", token: "abc" });
  // Not an item ID: the page opens with no panel.
  assert.deepEqual(parseRoute(`/threads/${thread}`, "?item=../x"), { page: "thread", id: thread });
});

test("opening and closing the panel is the same page", () => {
  const page: Route = { page: "thread", id: thread };
  assert.deepEqual(withItem(page, item), { ...page, item });
  assert.deepEqual(withItem({ ...page, item }, null), page);
  assert.ok(samePage(page, withItem(page, item)));
  assert.ok(!samePage(page, { page: "thread", id: "01JBZ0000000000000000000T2", item }));
  assert.deepEqual(withItem({ page: "review", token: "abc" }, item), {
    page: "review",
    token: "abc",
  });
});

const urls = (effects: readonly Effect[]) =>
  effects.flatMap((effect) => (effect.type === "http" ? [`${effect.method} ${effect.url}`] : []));

test("a plain click on an item opens its panel in history, leaving the page where it is", () => {
  const [model] = init({ page: "thread", id: thread });
  const [, effects] = update(model, { type: "itemOpened", id: item });
  assert.deepEqual(effects, [
    { type: "navigate", route: { page: "thread", id: thread, item }, stay: true },
  ]);
  // With a panel open, another item takes its place.
  const [open] = init({ page: "thread", id: thread, item });
  const [, again] = update(open, { type: "itemOpened", id: "jira:SYN-3" });
  assert.deepEqual(again, [
    {
      type: "navigate",
      route: { page: "thread", id: thread, item: "jira:SYN-3" },
      stay: true,
      replace: true,
    },
  ]);
});

test("a click on the item already open leaves the panel and the page as they are", () => {
  const [model] = init({ page: "thread", id: thread, item });
  assert.deepEqual(update(model, { type: "itemOpened", id: item })[1], []);
});

test("the panel opening reads its item and says it opened, without loading the page again", () => {
  const [model] = init({ page: "thread", id: thread });
  const [opened, effects] = update(model, {
    type: "routed",
    route: { page: "thread", id: thread, item },
  });
  assert.equal(opened.thread, model.thread);
  assert.deepEqual(opened.panel, {
    id: item,
    status: "loading",
    view: null,
    changedAt: null,
    problem: null,
  });
  assert.deepEqual(urls(effects), ["GET /api/items/jira%3ASYN-88", "POST /api/telemetry"]);
  const telemetry = effects.find((effect) => effect.type === "http" && effect.method === "POST");
  assert.deepEqual(telemetry?.type === "http" && telemetry.body, {
    name: "item.panel-opened",
    item,
  });
  // Closing goes back to the page as it was, in place.
  const [, closing] = update(opened, { type: "panelClosed" });
  assert.deepEqual(closing, [
    { type: "navigate", route: { page: "thread", id: thread }, replace: true, stay: true },
  ]);
  const [closed, none] = update(opened, { type: "routed", route: { page: "thread", id: thread } });
  assert.equal(closed.panel, null);
  assert.deepEqual(none, []);
});

test("an address with an item opens its panel with the page", () => {
  const [model, effects] = init({ page: "window", grouping: "epic", addTo: null, item });
  assert.equal(model.panel?.id, item);
  assert.ok(urls(effects).includes("GET /api/items/jira%3ASYN-88"));
});

test("leaving for the source tells, by the item and the way out", () => {
  const [model] = init({ page: "window", grouping: "epic", addTo: null });
  const [, effects] = update(model, { type: "sourceOpened", id: item, via: "link" });
  assert.deepEqual(
    effects.map((effect) => effect.type === "http" && effect.body),
    [{ name: "item.source-opened", item, via: "link" }],
  );
});

const view = (over: Partial<ItemPanelView> = {}): ItemPanelView => ({
  id: item,
  key: "SYN-88",
  source: "Jira",
  title: "Refunds",
  url: "https://oriel.atlassian.net/browse/SYN-88",
  readAt: "2026-10-29T09:00:00.000Z",
  updatedAt: "2026-10-01T11:00:00.000Z",
  read: { status: "ok", blocks: [] },
  ...over,
});

const ready = (model: Model, read = view()): Model => {
  const replied = update(model, {
    type: "replied",
    tag: { kind: "item", id: item },
    ok: true,
    body: read,
  })[0];
  return replied;
};

test("when the lists or the window load again, an open panel asks whether its item changed", () => {
  const [model] = init({ page: "thread", id: thread, item });
  const [, before] = update(model, { type: "threadsMoved" });
  // Nothing to compare until the read is in.
  assert.ok(!urls(before).some((url) => url.endsWith("/stamp")));
  const [, after] = update(ready(model), { type: "threadsMoved" });
  assert.ok(urls(after).includes("GET /api/items/jira%3ASYN-88/stamp"));
});

test("a reply for an item no longer open is dropped", () => {
  const [model] = init({ page: "thread", id: thread, item });
  const [stale] = update(model, {
    type: "replied",
    tag: { kind: "item", id: "jira:SYN-3" },
    ok: true,
    body: view({ id: "jira:SYN-3" }),
  });
  assert.equal(stale.panel?.status, "loading");
  const [failed] = update(model, {
    type: "replied",
    tag: { kind: "item", id: item },
    ok: false,
    body: { error: "Jira didn't answer." },
  });
  assert.deepEqual(
    [failed.panel?.status, failed.panel?.problem],
    ["failed", "Jira didn't answer."],
  );
  const [, retried] = update(failed, { type: "panel", msg: { type: "readAgainClicked" } });
  assert.deepEqual(urls(retried), ["GET /api/items/jira%3ASYN-88"]);
});

test("the read is behind only once the index saw a change after both the read and what it knew", () => {
  const panel = (changedAt: string | null, over: Partial<ItemPanelView> = {}): PanelModel => ({
    id: item,
    status: "ready",
    view: view(over),
    changedAt,
    problem: null,
  });
  assert.ok(!behind(panel(null)));
  assert.ok(!behind(panel("2026-10-01T11:00:00.000Z")));
  assert.ok(behind(panel("2026-10-29T09:05:00.000Z")));
  // An index that lagged the read catches up to a change made before it.
  assert.ok(!behind(panel("2026-10-29T08:00:00.000Z")));
  // An item the index didn't have, then has.
  assert.ok(behind(panel("2026-10-29T09:05:00.000Z", { updatedAt: null })));
});
