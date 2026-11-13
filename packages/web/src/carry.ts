// Oriel's one View Transition (motion A, OA-355): the window's composer
// carried from the page's foot into the window chat's rail, while the rail
// slides in and the page column narrows, and back as the rail folds. The
// names it moves are set only while it runs (`data-carrying`, window.css),
// so nothing else becomes a transition's part or a stacking context.

// Renders `latest()` inside a transition, so its old and new states are
// the snapshots; models that arrive meanwhile wait for it and render with
// it. Where the browser has none, it renders at once.
export function carrying(render: () => void): { pending(): boolean } {
  let waiting = false;
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function") {
    render();
    return { pending: () => false };
  }
  waiting = true;
  // With reduced motion nothing is named, so nothing moves: the whole window
  // cross-fades (window.css).
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    root.setAttribute("data-carrying", "");
  const transition = document.startViewTransition(async () => {
    waiting = false;
    render();
    // Preact renders in a microtask queued by `render`, which runs first.
    await Promise.resolve();
  });
  // Skipped, as when the page is hidden, it renders all the same, at once.
  transition.ready.catch(() => {});
  void transition.finished.finally(() => root.removeAttribute("data-carrying"));
  return { pending: () => waiting };
}
