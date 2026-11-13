// A block is typed data, so every text in it, a synced title included, renders as text.
import type { ComponentChildren } from "preact";
import { atLeast, named } from "./chart-values.ts";
import { PivotChart, SeriesChart, SpreadChart, TimelineChart } from "./charts.tsx";
import { kindOfItem } from "./item-id.ts";
import { Chip, Folded, ItemListContext } from "./parts.tsx";
import type { BlockView, ChipView, MemberView, ReviewTable, SketchView } from "./view.ts";

const number = (value: number) => value.toLocaleString("en-US");

const cellText = (cell: string | number | boolean | null) =>
  cell === null ? "—" : typeof cell === "boolean" ? (cell ? "yes" : "no") : String(cell);

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

// Every word in it is the source's or Oriel's, never the drafter's.
export function ReviewTables(props: {
  tables: readonly ReviewTable[];
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
        <Folded
          label={`${unread.length} tabs Oriel isn't reading`}
          entries={unread}
          find="Find a tab"
        >
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

const notRead = (unread: readonly ReviewTable[]): string => {
  const named = unread.slice(0, 3).map((table) => table.name);
  const more = unread.length - named.length;
  return `Not read: ${named.join(", ")}${more > 0 ? `, and ${more} more ${more === 1 ? "tab" : "tabs"}` : ""}.`;
};

// Framed from the sketch origin with no sandbox token. Its border and caption are Oriel's,
// outside the frame, so no sketch can fake them.
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
    // Its cells as text, so nothing in it is an item to cite.
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

const rowChip = ({ ref, row }: MemberView): ChipView => ({
  kind: "item",
  source: kindOfItem(ref.id) ?? "",
  key: ref.key,
  name: row?.title ?? ref.title ?? "Not in the index",
  url: ref.url,
  state: row?.status ?? null,
});
