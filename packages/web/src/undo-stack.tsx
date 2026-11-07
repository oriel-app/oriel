// The one stack of Undo notes (OA-142), shown in the bead (decision 0056,
// amended): the frame's own material, grown down from the band at the top
// centre of the page column. It drops as a small bead and spreads to say
// the newest note, with a count and the material's lips beneath it while
// there are more; a new note reflows it and swaps its words; and as the last
// one goes, its words go first, it narrows back to the bead, and the band
// takes it back (bead-motion.ts). At rest it is still. What last failed
// shows there too, until dismissed. None runs out while the pointer or focus
// is on the bead, which opens it as a list, newest first, each with its
// Undo. ⌘Z or Ctrl+Z undoes the newest that can be undone, and F8 takes the
// keyboard there. The window's one status region (`BeadStatus`) reads each
// note out once as it shows, and its alert what failed.
// Every note's model hears one hold, through `onHold`: an Undo lets go of the
// keyboard's, and a bead that goes, as when a page swaps it for another,
// lets go of both, since no leave event comes.
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import {
  type Aim,
  advance,
  arrive,
  beadPath,
  change,
  frameDriver,
  leave,
  lipPath,
  type Measures,
  type Motion,
  resting,
  retarget,
  room,
  settle,
  still,
  swapped,
  wordsClip,
} from "./bead-motion.ts";
import { type Dispatch, Link } from "./parts.tsx";
import {
  type Held,
  type Hold,
  holding,
  inShowingOrder,
  latestNote,
  notHeld,
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
      const face = wrap.current?.querySelector<HTMLElement>(".bead-layer");
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

  // What the bead draws, and how it moves (bead-motion.ts). `drawn` is the
  // face its words show: the newest, once the last one's words have gone,
  // and the last one while it leaves. The motion and the shape live in refs
  // and are drawn straight to the page each frame, with no render.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const drawn = useRef<Face | null>(null);
  const latestFace = useRef(face);
  latestFace.current = face;
  const motion = useRef<Motion | null>(null);
  const sizes = useRef<Sizes | null>(null);
  const hovered = useRef(false);
  const refocus = useRef(false);
  const bead = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const body = useRef<SVGPathElement>(null);
  const lips = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const cast = useId();
  const seed = () => sizes.current?.measures.seed ?? 0;

  const now = motion.current ?? still(0);
  if (face !== null) {
    if (drawn.current === null || now.phase === "hidden" || now.phase === "leaving") {
      motion.current = arrive(now, seed(), reducedMotion());
      drawn.current = face;
    } else if (wording(drawn.current) !== wording(face)) {
      motion.current = change(now);
      // Reduced motion swaps the words at once.
      if (motion.current.phase === "swapping") {
        refocus.current = bead.current?.contains(document.activeElement) === true;
        drawn.current = face;
      }
    } else drawn.current = face;
  } else if (drawn.current !== null) motion.current = leave(now);
  // With nothing drawn, the next note starts from nothing.
  else motion.current = null;
  const showing = drawn.current;

  // Each frame: the springs on, then the shape. A face whose words have
  // gone gives way to the newest; one that has left, to nothing.
  const frames = useRef<ReturnType<typeof frameDriver> | null>(null);
  frames.current ??= frameDriver(
    { request: (run) => requestAnimationFrame(run), cancel: (id) => cancelAnimationFrame(id) },
    {
      moving: () => motion.current !== null && !resting(motion.current),
      step: (dt) => {
        const at = sizes.current;
        const was = motion.current;
        if (!at || !was) return;
        const next = settle(advance(was, dt, aimOf(at, hovered.current), at.measures));
        motion.current = next;
        if (next.phase === "swapping" && was.phase !== "swapping") {
          refocus.current = bead.current?.contains(document.activeElement) === true;
          drawn.current = latestFace.current;
          redraw(0);
        }
        if (next.phase === "hidden" && drawn.current !== null && latestFace.current === null) {
          drawn.current = null;
          redraw(0);
        }
        draw();
      },
    },
  );
  useEffect(() => () => frames.current?.stop(), []);

  // The shape now, straight to the page.
  const draw = () => {
    const at = sizes.current;
    const m = motion.current;
    if (!at || !m) return;
    const shape = { width: m.width.value, height: m.height.value, wanted: at.width };
    const column = at.column;
    body.current?.setAttribute("d", beadPath(shape, column, at.measures));
    // The notes behind the newest, as the material's lips beneath it,
    // until it opens as a list or goes.
    const face = drawn.current;
    const behind = face && face.said.length === 1 && m.phase !== "leaving" ? face.count - 1 : 0;
    lips.forEach((lip, i) =>
      lip.current?.setAttribute(
        "d",
        behind > i ? lipPath(shape, column, at.measures, (i + 1) as 1 | 2) : "",
      ),
    );
    const words = Math.max(0, Math.min(1, m.words.value));
    const box = bead.current;
    if (box) box.style.clipPath = wordsClip(shape, at.width, at.height, at.measures.radius);
    const wrapped = wrap.current;
    wrapped?.toggleAttribute("data-moving", !resting(m));
    if (m.reduced) {
      wrapped?.style.setProperty("--bead-shown", `${words}`);
      layer.current?.removeAttribute("style");
      return;
    }
    const style = layer.current?.style;
    if (!style) return;
    // Settled words take no transform or filter, so they draw crisp.
    const settled = words > 0.98;
    style.opacity = settled ? "" : `${words}`;
    style.transform = settled ? "" : `translateY(${((1 - words) * -5).toFixed(2)}px)`;
    style.filter = settled ? "" : `blur(${((1 - words) * 4).toFixed(2)}px)`;
    if (box) box.style.pointerEvents = words > 0.5 ? "" : "none";
  };

  // Its size, from its words laid out at their final width, as wide as the
  // room the column leaves it: measured again as the column or the words
  // change, so a resize reflows it rather than breaking the frame.
  const measure = () => {
    const box = wrap.current;
    const words = bead.current;
    const at = layer.current;
    if (!box || !words || !at) return;
    const css = getComputedStyle(box);
    const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0;
    const measures: Measures = {
      seed: px("--bead-seed"),
      neck: px("--bead-neck"),
      corner: px("--frame-curve"),
      gap: px("--bead-gap"),
      swell: px("--bead-swell"),
      radius: parseFloat(getComputedStyle(words).borderBottomLeftRadius) || 0,
    };
    const column = box.clientWidth;
    box.style.setProperty("--bead-room", `${room(column, measures)}px`);
    const width = at.offsetWidth;
    const height = at.offsetHeight;
    words.style.left = `${Math.round((column - width) / 2)}px`;
    sizes.current = { column, width, height, measures };
    aimAgain();
    draw();
  };
  // Aimed anew at its size and the pointer, and moving if that moves it.
  const aimAgain = () => {
    const at = sizes.current;
    if (at && motion.current)
      motion.current = retarget(motion.current, aimOf(at, hovered.current), at.measures);
    frames.current?.kick();
  };
  useLayoutEffect(() => {
    measure();
    if (motion.current?.phase === "swapping") {
      motion.current = swapped(motion.current);
      if (refocus.current) {
        refocus.current = false;
        const action = layer.current?.querySelector<HTMLElement>(".bead-action:not(:disabled)");
        (action ?? layer.current)?.focus();
      }
    }
    frames.current?.kick();
  });
  useLayoutEffect(() => {
    const box = wrap.current;
    const at = layer.current;
    if (!box || !at) return;
    const watching = new ResizeObserver(() => measure());
    watching.observe(box);
    watching.observe(at);
    return () => watching.disconnect();
  }, [showing === null, showing?.key]);

  const swell = (on: boolean) => {
    hovered.current = on;
    aimAgain();
  };

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
          data-reduced={motion.current?.reduced || undefined}
        >
          <svg class="bead-shape" aria-hidden="true">
            <defs>
              <filter
                id={cast}
                filterUnits="userSpaceOnUse"
                x="-100"
                y="-100"
                width="10000"
                height="2000"
              >
                <feDropShadow dx="0" dy="1" stdDeviation="2.2" />
              </filter>
            </defs>
            <path ref={lips[1]} filter={`url(#${cast})`} />
            <path ref={lips[0]} filter={`url(#${cast})`} />
            <path ref={body} filter={`url(#${cast})`} />
          </svg>
          <div
            ref={bead}
            class="bead"
            onMouseEnter={() => {
              swell(true);
              hold("pointer", true);
            }}
            onMouseLeave={() => {
              swell(false);
              hold("pointer", false);
            }}
            onFocusIn={() => hold("focus", true)}
            onFocusOut={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                hold("focus", false);
            }}
          >
            <BeadFace
              key={showing.key}
              face={showing}
              latest={latest?.key ?? null}
              dispatch={props.dispatch}
              undo={undo}
              at={layer}
            />
          </div>
        </div>
      )}
    </>
  );
}

// What changing to `face` from what shows means: other words, which go
// before the new ones come, or the same, changed in place, as when it opens
// as a list.
const wording = (face: Face): string => {
  const [first] = face.said;
  const words = first?.kind === "note" ? first.note.said : (first?.problem.said ?? "");
  return `${face.key}\n${face.tone}\n${words}`;
};

// Its measures and its size now: the column it centres on, and its face's
// width, clamped to the room, and height.
type Sizes = { column: number; width: number; height: number; measures: Measures };

const aimOf = (at: Sizes, hovered: boolean): Aim => ({
  width: at.width,
  height: at.height,
  hovered,
});

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      <p class="visually-hidden bead-alert" role="alert">
        {told.alert}
      </p>
    </>
  );
}

// One face of the bead: its count, then each thing it says, with its mark
// and its Undo, link or Dismiss. A sentence cut short to fit keeps all its
// words, for a screen reader; only its look ends in an ellipsis.
function BeadFace(props: {
  face: Face;
  latest: string | null;
  dispatch: Dispatch;
  undo(onUndo: () => void): void;
  at?: { current: HTMLDivElement | null };
}) {
  const { face } = props;
  return (
    <div
      ref={props.at}
      class="bead-layer"
      tabIndex={-1}
      data-list={face.said.length > 1 || undefined}
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
            <span class="bead-said">{said.problem.said}</span>
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
