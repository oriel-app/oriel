import { render } from "preact";
import { App } from "./app.tsx";
import { perform } from "./effects.ts";
import { init, update } from "./update.ts";

const root = document.getElementById("app");
if (root === null) throw new Error("the page has no #app element");

const grouping = new URLSearchParams(location.search).get("grouping");
render(<App program={{ init: init(grouping), update, perform }} />, root);
