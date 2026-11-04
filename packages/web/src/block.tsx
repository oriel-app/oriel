// A block under the agent's reply (decision 0030): a table, bars or rows of
// items, or a waiting connection's preview (decision 0051), which Oriel
// built from a read's result. One renderer, for a
// thread's page and the window chat. It is typed data, so every text in it,
// a synced title included, renders as text; its caption says where it came
// from. One from outside the workstream, as what search() found is (the
// escape hatch), says so and is read-only.
import { kindOfItem } from "./item-id.ts";
import { Chip, ItemListContext } from "./parts.tsx";
import type { BlockView, ChipView, MemberView, SketchView } from "./view.ts";

const number = (value: number) => value.toLocaleString("en-US");

const cellText = (cell: string | number | boolean | null) =>
  cell === null ? "—" : typeof cell === "boolean" ? (cell ? "yes" : "no") : String(cell);

export function BlockFigure({ block }: { block: BlockView }) {
  return (
    <figure class="answer-block" data-form={block.form} data-outside={block.outside || undefined}>
      {block.form === "preview" ? (
        <p class="search-label">Read live from the source · not items</p>
      ) : (
        block.outside && <p class="search-label">Outside this workstream · read-only</p>
      )}
      <BlockBody block={block} />
      {block.more > 0 && <p class="block-more">and {number(block.more)} more</p>}
      <figcaption>{block.caption}</figcaption>
    </figure>
  );
}

// A sketch under the agent's reply (decision 0033): its HTML, framed from
// the sketch origin, in a frame with no sandbox token, at one of three
// heights; a taller sketch scrolls inside it. Its border and caption are
// Oriel's, outside the frame, so no sketch can fake them.
export function SketchFigure({ sketch }: { sketch: SketchView }) {
  return (
    <figure class="answer-sketch">
      <iframe
        sandbox=""
        src={sketch.src}
        data-height={sketch.height}
        title="A sketch by the agent"
        referrerpolicy="no-referrer"
      />
      <figcaption>Sketched by the agent · not checked against Oriel's data</figcaption>
    </figure>
  );
}

function BlockBody({ block }: { block: BlockView }) {
  switch (block.form) {
    case "bars": {
      // One series, ranked, each value labelled; nothing grows past the
      // largest, and a value under zero draws no bar.
      const top = Math.max(...block.bars.map((bar) => bar.value), 0);
      return (
        <ol class="block-bars">
          {block.bars.map((bar, i) => (
            <li key={i}>
              <span class="block-bar-label">{bar.label}</span>
              <span class="block-bar-track" aria-hidden="true">
                <span
                  class="block-bar"
                  style={{ width: `${top > 0 ? (Math.max(bar.value, 0) / top) * 100 : 0}%` }}
                />
              </span>
              <span class="block-bar-value">{number(bar.value)}</span>
            </li>
          ))}
        </ol>
      );
    }
    case "table":
      return (
        <table class="block-table">
          <thead>
            <tr>
              {block.columns.map((column, j) => (
                <th
                  key={column}
                  scope="col"
                  class={typeof block.rows[0]?.[j] === "number" ? "num" : undefined}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} class={typeof cell === "number" ? "num" : undefined}>
                    {typeof cell === "number" ? number(cell) : cellText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    // A waiting connection's preview (decision 0051): each table its source
    // shows, its cells as text, so nothing in it is an item to cite.
    case "preview":
      return (
        <div class="block-preview">
          {block.tables.map((table, i) => (
            <table class="block-table" key={i}>
              <caption>{table.name}</caption>
              <thead>
                <tr>
                  {table.columns.map((column, j) => (
                    <th key={j} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => (
                      <td key={j}>{cellText(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      );
    case "rows":
      return (
        <ItemListContext.Provider value={block.items.map((item) => item.ref.id)}>
          <ul class="block-rows">
            {block.items.map((item, i) => (
              <li key={i}>
                <Chip id={item.ref.id} view={rowChip(item)} />
                {item.inRegion && <span class="in-region">in this workstream</span>}
              </li>
            ))}
          </ul>
        </ItemListContext.Provider>
      );
  }
}

// A row's item as a chip, so it looks as it does named in a sentence
// (decision 0032); one the index no longer has says so.
const rowChip = ({ ref, row }: MemberView): ChipView => ({
  kind: "item",
  source: kindOfItem(ref.id) ?? "",
  key: ref.key,
  name: row?.title ?? ref.title ?? "Not in the index",
  url: ref.url,
  state: row?.status ?? null,
});
