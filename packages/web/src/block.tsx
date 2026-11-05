// A block under the agent's reply (decision 0030): a table, bars or rows of
// items, or a waiting connection's preview (decision 0051), which Oriel
// built from a read's result. One renderer, for a
// thread's page and the window chat. It is typed data, so every text in it,
// a synced title included, renders as text; its caption says where it came
// from. One from outside the workstream, as what search() found is (the
// escape hatch), says so and is read-only.
import type { ComponentChildren } from "preact";
import { atLeast, named, PivotChart, SeriesChart, SpreadChart, TimelineChart } from "./charts.tsx";
import { kindOfItem } from "./item-id.ts";
import { Chip, Folded, ItemListContext } from "./parts.tsx";
import type { BlockView, ChipView, MemberView, ReviewTable, SketchView } from "./view.ts";

const number = (value: number) => value.toLocaleString("en-US");

const cellText = (cell: string | number | boolean | null) =>
  cell === null ? "—" : typeof cell === "boolean" ? (cell ? "yes" : "no") : String(cell);

// `compact`: as a pin shows it on the overview, smaller, with its caption.
export function BlockFigure({ block, compact }: { block: BlockView; compact?: boolean }) {
  return (
    <figure
      class="answer-block"
      data-form={block.form}
      data-outside={block.outside || undefined}
      data-compact={compact || undefined}
    >
      {block.form === "preview" ? (
        <p class="search-label">Read live from the source · not items</p>
      ) : (
        block.outside && !compact && <p class="search-label">Outside this workstream · read-only</p>
      )}
      <BlockBody block={block} compact={compact ?? false} />
      {block.more > 0 && <p class="block-more">and {number(block.more)} more</p>}
      <figcaption>{block.caption}</figcaption>
    </figure>
  );
}

// A draft of a connection's options as Oriel draws it from its source
// (decision 0051): each table it reads, with each column's letter, the
// header the source has there and the field it feeds, then its first rows
// and what it reads and leaves out. Every word in it is the source's or
// Oriel's, never the drafter's; what isn't read is named in one line.
export function ReviewTables(props: {
  tables: readonly ReviewTable[];
  // What the person changes of each table, under it, while they edit
  // (OA-232); then the tables not read, folded into one line past a few,
  // to read one.
  controls?: ((table: ReviewTable) => ComponentChildren) | null | false;
}) {
  const { tables, controls } = props;
  const unread = tables.filter((table) => table.columns.length === 0);
  const read = tables.filter((table) => table.columns.length > 0);
  return (
    <div class="review-tables">
      {read.map((table, i) => (
        <section key={i} class="review-table">
          <div class="review-scroll">
            <table class="block-table">
              <caption>{table.name}</caption>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.at} scope="col" data-feeds={column.feeds !== null || undefined}>
                      {column.at}
                    </th>
                  ))}
                </tr>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.at} scope="col" data-feeds={column.feeds !== null || undefined}>
                      {column.header ?? "—"}
                    </th>
                  ))}
                </tr>
                <tr class="review-feeds">
                  {table.columns.map((column) => (
                    <td key={column.at} data-feeds={column.feeds !== null || undefined}>
                      {column.feeds ?? "Content"}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {table.columns.map((column, j) => (
                      <td key={column.at}>{cellText(row[j] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul class="review-lines">
            {table.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {controls && controls(table)}
        </section>
      ))}
      {controls && unread.length <= 3 ? (
        unread.map((table, i) => (
          <section key={`unread-${i}`} class="review-table">
            <p class="review-name">{table.name}</p>
            {controls(table)}
          </section>
        ))
      ) : controls ? (
        <Folded label={`${unread.length} tabs not read`} entries={unread} find="Find a tab">
          {(table) => (
            <section class="review-table">
              <p class="review-name">{table.name}</p>
              {controls(table)}
            </section>
          )}
        </Folded>
      ) : (
        unread.length > 0 && <p class="review-unread">{notRead(unread)}</p>
      )}
    </div>
  );
}

// What a draft doesn't read, in a line: a few by name, and how many more.
const notRead = (unread: readonly ReviewTable[]): string => {
  const named = unread.slice(0, 3).map((table) => table.name);
  const more = unread.length - named.length;
  return `Not read: ${named.join(", ")}${more > 0 ? `, and ${more} more ${more === 1 ? "tab" : "tabs"}` : ""}.`;
};

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

function BlockBody({ block, compact }: { block: BlockView; compact: boolean }) {
  switch (block.form) {
    case "series":
      return <SeriesChart chart={block} compact={compact} />;
    case "timeline":
      return <TimelineChart chart={block} compact={compact} />;
    case "spread":
      return <SpreadChart chart={block} compact={compact} />;
    case "pivot":
      return <PivotChart chart={block} compact={compact} />;
    case "bars": {
      // One series, ranked, each value labelled; nothing grows past the
      // largest, and a value under zero draws no bar.
      const top = Math.max(...block.bars.map((bar) => bar.value), 0);
      return (
        <ol class="block-bars">
          {block.bars.map((bar, i) => (
            <li key={i}>
              <span class="block-bar-label">{named(block, bar.label)}</span>
              <span class="block-bar-track" aria-hidden="true">
                <span
                  class="block-bar"
                  style={{ width: `${top > 0 ? (Math.max(bar.value, 0) / top) * 100 : 0}%` }}
                />
              </span>
              <span class="block-bar-value">
                {atLeast(bar.atLeast)}
                {number(bar.value)}
              </span>
            </li>
          ))}
        </ol>
      );
    }
    case "table": {
      const bounded = new Set(block.atLeast?.map(({ row, column }) => `${row}:${column}`));
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
                    {typeof cell === "number"
                      ? `${atLeast(bounded.has(`${i}:${j}`))}${number(cell)}`
                      : typeof cell === "string"
                        ? named(block, cell)
                        : cellText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
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
