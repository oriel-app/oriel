// The one stack of Undo notes (OA-142), shown in the bead (decision 0056):
// an ink pill at the top centre of the page column, on the window's top
// line. It grows from a dot to say the newest note, with a count and edges
// beneath it while there are more, and shrinks back to the dot as the last
// one goes. A note that keeps its key changes shape in place: its edges
// move, and its words don't. What last failed shows there too, with no
// spring, until dismissed. None runs out while the pointer or focus is on
// the bead, which opens it as a list, newest first, each with its Undo.
// ⌘Z or Ctrl+Z undoes the newest that can be undone, and F8 takes the
// keyboard there. The window's one status region (`BeadStatus`) reads each
// note out once as it shows, and its alert what failed.
// Every note's model hears one hold, through `onHold`: an Undo lets go of the
// keyboard's, and a bead that goes, as when a page swaps it for another,
// lets go of both, since no leave event comes.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import { type Dispatch, Link } from "./parts.tsx";
import {
  type Held,
  type Hold,
  holding,
  inShowingOrder,
  latestNote,
  notHeld,
  undoMs,
  type UndoNote,
  type UndoProblem,
} from "./undos.ts";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const shortcut = mac ? "Meta+Z" : "Control+Z";
const hint = mac ? "⌘Z" : "Ctrl+Z";

// Every note's hold goes the one way, whichever stack is on screen.
export const holdUndos = (dispatch: Dispatch) => (by: Hold, held: boolean) =>
  dispatch({ type: "undoHeld", by, held });

// What the bead says, newest first: the notes, and what failed among them.
// The first is its face; the rest show as a count until it opens.
type Said =
  | { kind: "problem"; key: string; problem: UndoProblem }
  | { kind: "note"; key: string; note: UndoNote };

type Face = { key: string; said: Said[]; count: number; tone: Tone };
type Tone = NonNullable<UndoNote["mark"]> | "problem" | "note";

export function UndoStack(props: {
  notes: readonly UndoNote[];
  problem?: UndoProblem | null;
  onHold(by: Hold, held: boolean): void;
  // For a note's link.
  dispatch: Dispatch;
}) {
  const { problem } = props;
  // What it says, in the order each first showed, what failed among the
  // notes: whatever is newest is the bead's face.
  const said: Said[] = inShowingOrder(shown, [
    ...props.notes.map((note) => ({ kind: "note" as const, key: note.key, note })),
    // A failure with no note of its own is new when what it says is.
    ...(problem
      ? [{ kind: "problem" as const, key: problem.key ?? `problem ${problem.said}`, problem }]
      : []),
  ]).toReversed();
  shown = said.map((each) => each.key).toReversed();
  const notes = said.flatMap((each) => (each.kind === "note" ? [each.note] : [])).toReversed();
  // What holds the bead now, and the latest `onHold`, for letting go after
  // it has gone. Held, it opens; let go, its countdown starts again.
  const held = useRef<Held>(notHeld);
  const [open, setOpen] = useState(false);
  const letGo = useRef(0);
  const onHold = useRef(props.onHold);
  onHold.current = props.onHold;
  const hold = (by: Hold, on: boolean) => {
    if (held.current[by] === on) return;
    const was = holding(held.current);
    held.current = { ...held.current, [by]: on };
    if (was && !holding(held.current)) letGo.current += 1;
    setOpen(holding(held.current));
    onHold.current(by, on);
  };
  useEffect(
    () => () => {
      hold("pointer", false);
      hold("focus", false);
    },
    [],
  );
  const undo = (onUndo: () => void) => {
    hold("focus", false);
    onUndo();
  };
  const latest = latestNote(notes);
  const undoLatest = useRef<(() => void) | null>(null);
  const latestUndo = latest && !latest.disabled ? latest.onUndo : null;
  undoLatest.current = latestUndo && (() => undo(latestUndo));
  const armed = latest !== null;
  useEffect(() => {
    if (!armed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      // A text field undoes its own typing.
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea"))
      )
        return;
      event.preventDefault();
      undoLatest.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed]);

  // Show notes: F8, from anywhere, a text field included, takes the
  // keyboard to the bead's newest action, where focus holds it open; Escape
  // takes it back. Tab may be many stops away, and a note runs out.
  const wrap = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const any = notes.length > 0 || problem != null;
  useEffect(() => {
    if (!any) return;
    const onKey = (event: KeyboardEvent) => {
      const inside = wrap.current?.contains(event.target as Node | null) === true;
      if (event.key === "Escape" && inside) {
        // Only the bead's: the panel or the drawer behind it stays.
        event.stopPropagation();
        const back = cameFrom.current;
        cameFrom.current = null;
        if (back?.isConnected && back !== document.body) back.focus();
        else (event.target as HTMLElement).blur();
        return;
      }
      if (event.key !== "F8" || event.metaKey || event.ctrlKey || event.altKey) return;
      // With no action on its face, the bead itself, which focus opens.
      const face = wrap.current?.querySelector<HTMLElement>(".bead-layer:not([data-gone])");
      const action = face?.querySelector<HTMLElement>(".bead-action:not(:disabled)") ?? face;
      if (!action) return;
      event.preventDefault();
      if (!inside && document.activeElement instanceof HTMLElement)
        cameFrom.current = document.activeElement;
      action.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [any]);

  const first = said[0];
  const face: Face | null = first
    ? {
        key: first.key,
        said: open ? said : [first],
        count: said.length,
        tone: first.kind === "problem" ? "problem" : (first.note.mark ?? "note"),
      }
    : null;

  // The faces it showed before, their words fading as the next one's come;
  // and the last, while the bead shrinks back to its dot.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const last = useRef<Face | null>(null);
  const leaving = useRef<Face | null>(null);
  const fading = useRef<{ id: number; face: Face }[]>([]);
  const faded = useRef(0);
  const before = last.current ?? leaving.current;
  if (face && before && before.key !== face.key)
    fading.current = [...fading.current, { id: (faded.current += 1), face: before }];
  if (face) leaving.current = null;
  else if (last.current) leaving.current = last.current;
  last.current = face;
  const showing = face ?? leaving.current;
  // Going, it lets go: no leave event comes from a bead that isn't there.
  useLayoutEffect(() => {
    if (face !== null) return;
    hold("pointer", false);
    hold("focus", false);
  }, [face === null]);

  // Each note read out once, as it shows, or as what it says changes, in
  // the window's one status region; what failed, in its alert.
  const telling = notes.flatMap((note) => {
    const words = note.heard ? `${note.said} ${note.heard}` : note.said;
    if (heard.get(note.key) === words) return [];
    heard.set(note.key, words);
    return [words];
  });
  for (const key of heard.keys()) if (!notes.some((note) => note.key === key)) heard.delete(key);
  const failed = problem?.said ?? "";
  useEffect(() => {
    if (telling.length > 0) tell?.({ status: telling.join(" ") });
  });
  useEffect(() => tell?.({ alert: failed }), [failed]);

  // The bead takes its face's size, measured at its final width, so the
  // words lay out once and only the edges move.
  const layer = useRef<HTMLDivElement>(null);
  // Held open, it may hang over the page; otherwise it makes room for what
  // it would cover.
  const opened = open && said.length > 1;
  // What its size follows: measured again only when this changes, or the
  // words reflow.
  const shape =
    face &&
    [
      opened,
      face.count,
      ...face.said.map((each) => (each.kind === "note" ? each.note.said : each.problem.said)),
    ].join("\n");
  useLayoutEffect(() => {
    const at = layer.current;
    const box = wrap.current;
    if (!at || !box || face === null) return;
    const size = () => {
      const w = at.offsetWidth + 1;
      const h = at.offsetHeight;
      box.style.setProperty("--w", `${w}px`);
      box.style.setProperty("--h", `${h}px`);
      if (!opened) makeRoom(box, w, h);
    };
    size();
    // And again as the page under it changes: another page, a page that
    // loads, at the window's height or not, or the panel or sidebar moving
    // it. Changes to the page are looked at once a frame.
    const watching = new ResizeObserver(size);
    watching.observe(at);
    let frame = 0;
    const changed = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(() => ((frame = 0), size()));
    });
    const page = box.closest(".shell")?.querySelector(".shell-main");
    if (page) {
      watching.observe(page);
      changed.observe(page, { childList: true, subtree: true });
    }
    addEventListener("resize", size);
    return () => {
      watching.disconnect();
      changed.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener("resize", size);
    };
  }, [face?.key, shape]);
  useLayoutEffect(() => {
    if (face === null) noRoom();
  }, [face === null]);
  useEffect(() => noRoom, []);

  return (
    <>
      {showing && (
        <div
          ref={wrap}
          class="bead-wrap"
          role="region"
          aria-label="Notes"
          aria-keyshortcuts="F8"
          data-tone={showing.tone}
          data-count={Math.min(showing.count, 3)}
          data-open={(open && showing.count > 1) || undefined}
          data-held={open || undefined}
          data-leaving={face === null || undefined}
          onMouseEnter={() => hold("pointer", true)}
          onMouseLeave={() => hold("pointer", false)}
          onFocusIn={() => hold("focus", true)}
          onFocusOut={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              hold("focus", false);
          }}
        >
          <div class="bead-under" data-depth="2" />
          <div class="bead-under" data-depth="1" />
          <div
            class="bead"
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
              if (last.current !== null || leaving.current === null) return;
              leaving.current = null;
              fading.current = [];
              redraw(0);
            }}
          >
            {fading.current.map(({ id, face: was }) => (
              <Layer
                key={`was-${id}`}
                face={was}
                gone
                latest={null}
                dispatch={props.dispatch}
                undo={undo}
                onGone={() => {
                  fading.current = fading.current.filter((each) => each.id !== id);
                  redraw(0);
                }}
              />
            ))}
            <Layer
              key={showing.key}
              face={showing}
              gone={face === null}
              latest={latest?.key ?? null}
              dispatch={props.dispatch}
              undo={undo}
              at={layer}
            />
            {face && face.tone !== "problem" && (
              <div
                key={`${face.key} ${said[0]?.kind === "note" ? said[0].note.said : ""} ${letGo.current}`}
                class="bead-time"
                style={{ "--bead-life": `${undoMs}ms` }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Where the bead, `w` by `h`, would cover a control on the page, such as
// the overview's counts or Browse's view tabs, the page moves down under it
// for the note's life, rather than be covered (decision 0056). The crumb it
// may cover. Only the page's own top lines count: on a page scrolled past
// them it covers what scrolled under it, as the bar does, and on a narrow
// screen it sits in the bar.
const narrowScreen = "(max-width: 760px)";
const control = "a[href], button, input, select, textarea, [role='tab']";

function makeRoom(box: HTMLElement, w: number, h: number) {
  const shell = box.closest<HTMLElement>(".shell");
  const main = shell?.querySelector<HTMLElement>(".shell-main");
  if (!shell || !main) return;
  if (matchMedia(narrowScreen).matches) return noRoom();
  const at = box.getBoundingClientRect();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const top = at.top;
  const bottom = top + Math.max(h, 2 * rem);
  // Once made, the room stays until the bead goes, so the page doesn't
  // move back and forth as its notes change.
  const had = parseFloat(shell.style.getPropertyValue("--bead-room")) || 0;
  if (scrollY >= bottom || bottom - top <= had) return;
  // Where the page's controls would be without the room it has now, as far
  // as it has moved so far.
  const moved = parseFloat(getComputedStyle(main).paddingTop) || 0;
  const covers = (x: number, y: number) =>
    document.elementsFromPoint(x, y + moved).some((element) => {
      const found = element.closest(control);
      return (
        found !== null &&
        found.closest(".shell-main") !== null &&
        found.closest(".bead-wrap, .crumb") === null
      );
    });
  const rows = [top + 4, (top + bottom) / 2, bottom - 4];
  let covered = false;
  for (let x = at.left - w / 2 + 4; x <= at.left + w / 2 - 4 && !covered; x += 12)
    covered = rows.some((y) => covers(x, y));
  if (!covered) return;
  shell.style.setProperty("--bead-room", `${Math.ceil(bottom - top)}px`);
  shell.setAttribute("data-bead-room", "");
}

function noRoom() {
  const shell = document.querySelector<HTMLElement>(".shell[data-bead-room]");
  shell?.removeAttribute("data-bead-room");
  shell?.style.removeProperty("--bead-room");
}

// The window's one status region and alert for the bead, there from the
// start on every page but a review link's, whichever page's bead is on
// screen (app.tsx); what each note last said there, so a bead that a
// page swaps for another's doesn't say it again; and the order its notes
// first showed in, so that bead keeps it.
const heard = new Map<string, string>();
let shown: readonly string[] = [];
type Told = { status?: string; alert?: string };
let tell: ((told: Told) => void) | null = null;

export function BeadStatus() {
  const [told, setTold] = useState({ n: 0, status: "", alert: "" });
  useLayoutEffect(() => {
    tell = (next) =>
      setTold((was) => ({
        n: next.status === undefined ? was.n : was.n + 1,
        status: next.status ?? was.status,
        alert: next.alert ?? was.alert,
      }));
    return () => {
      tell = null;
    };
  }, []);
  return (
    <>
      <p class="visually-hidden bead-status" role="status">
        <span key={told.n}>{told.status}</span>
      </p>
      <p class="visually-hidden" role="alert">
        {told.alert}
      </p>
    </>
  );
}

// One face of the bead: its count, then each thing it says, with its mark
// and its Undo, link or Dismiss. A face it showed before is inert as its
// words fade, and says when they have.
function Layer(props: {
  face: Face;
  gone: boolean;
  latest: string | null;
  dispatch: Dispatch;
  undo(onUndo: () => void): void;
  at?: { current: HTMLDivElement | null };
  onGone?(): void;
}) {
  const { face, gone } = props;
  return (
    <div
      ref={props.at}
      class="bead-layer"
      tabIndex={gone ? undefined : -1}
      data-list={face.said.length > 1 || undefined}
      data-gone={gone || undefined}
      inert={gone}
      aria-hidden={gone || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && gone) props.onGone?.();
      }}
    >
      {face.said.length === 1 && face.count > 1 && (
        <span class="bead-count" aria-hidden="true">
          {face.count}
        </span>
      )}
      {face.said.map((said) =>
        said.kind === "problem" ? (
          <div class="bead-row" key={said.key}>
            <BeadMark mark="problem" />
            <span class="bead-said" key={said.problem.said}>
              {said.problem.said}
            </span>
            <button type="button" class="bead-action" onClick={said.problem.onDismiss}>
              Dismiss
            </button>
          </div>
        ) : (
          <NoteRow
            key={said.key}
            note={said.note}
            keys={said.key === props.latest}
            dispatch={props.dispatch}
            undo={props.undo}
          />
        ),
      )}
      {face.tone === "caught-up" && face.said.length === 1 && <span class="bead-glint" />}
    </div>
  );
}

function NoteRow(props: {
  note: UndoNote;
  keys: boolean;
  dispatch: Dispatch;
  undo(onUndo: () => void): void;
}) {
  const { onUndo, ...note } = props.note;
  return (
    <div class="bead-row" data-bare={(!note.link && !onUndo && !note.cannot) || undefined}>
      {note.mark && <BeadMark key={note.mark} mark={note.mark} />}
      <span class="bead-said" key={note.said}>
        {note.said}
        {note.heard && <span class="visually-hidden"> {note.heard}</span>}
      </span>
      {note.link ? (
        <Link
          route={note.link.route}
          dispatch={props.dispatch}
          class="bead-action"
          aria-label={note.link.label}
        >
          {note.link.text}
        </Link>
      ) : onUndo ? (
        <UndoButton
          label={note.label}
          disabled={note.disabled}
          keys={props.keys}
          hint={props.keys}
          class="bead-action"
          onClick={() => props.undo(onUndo)}
        />
      ) : (
        note.cannot && <span class="bead-cannot">{note.cannot}</span>
      )}
    </div>
  );
}

// What a note's mark draws: an apply under way, breathing; done, a check
// that draws itself; nothing else needing the user, Oriel's own mark, its
// panes lit one by one; or what failed.
function BeadMark(props: { mark: Tone }) {
  switch (props.mark) {
    case "applying":
      return (
        <span class="bead-mark" data-mark="applying">
          <span class="bead-dot" />
        </span>
      );
    case "applied":
      return (
        <svg class="bead-mark" data-mark="applied" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" />
          <path d="M5 8.3l2.1 2.1L11 6.2" pathLength={1} />
        </svg>
      );
    case "caught-up":
      return (
        <svg class="bead-mark" data-mark="caught-up" viewBox="0 0 20 20" aria-hidden="true">
          <g class="bead-panes">
            <rect class="bead-pane" x="2.5" y="2.5" width="15" height="6" />
            <rect class="bead-pane" x="2.5" y="8.5" width="7.5" height="9" />
            <rect class="bead-pane" x="10" y="8.5" width="7.5" height="9" />
          </g>
          <rect class="bead-frame" x="2.5" y="2.5" width="15" height="15" rx="3.5" pathLength={1} />
          <path class="bead-frame" d="M2.5 8.5h15M10 8.5v9" pathLength={1} />
        </svg>
      );
    case "problem":
      return (
        <svg class="bead-mark" data-mark="problem" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.6" />
          <path d="M8 4.8v3.8M8 11v.2" />
        </svg>
      );
    case "note":
      return null;
  }
}

// A note's Undo, in the bead or beside the change it undoes (decision
// 0024). `keys`: whether ⌘Z or Ctrl+Z presses it; `hint`: whether it shows
// that key.
export function UndoButton(props: {
  label: string;
  disabled?: boolean;
  keys?: boolean;
  hint?: boolean;
  class?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      class={props.class ?? "undo-action"}
      disabled={props.disabled}
      aria-label={props.label}
      aria-keyshortcuts={props.keys ? shortcut : undefined}
      onClick={props.onClick}
    >
      Undo
      {props.hint && <kbd>{hint}</kbd>}
    </button>
  );
}
