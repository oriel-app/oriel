import { render } from "preact";
import { App } from "./app.tsx";
import { perform } from "./effects.ts";
import { init, update } from "./root.ts";
import { parseRoute } from "./route.ts";

const root = document.getElementById("app");
if (root === null) throw new Error("the page has no #app element");

render(
  <App program={{ init: init(parseRoute(location.pathname, location.search)), update, perform }} />,
  root,
);
