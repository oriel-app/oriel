// The transition's names are set only while it runs (`data-carrying`), so nothing else
// becomes a transition's part or a stacking context.

export function carrying(render: () => void): { pending(): boolean } {
  let waiting = false;
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function") {
    render();
    return { pending: () => false };
  }
  waiting = true;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    root.setAttribute("data-carrying", "");
  const transition = document.startViewTransition(async () => {
    waiting = false;
    render();
    // Preact renders in a microtask queued by `render`, which runs first.
    await Promise.resolve();
  });
  // `ready` rejects when the transition is skipped, as when the page is hidden; it renders anyway.
  transition.ready.catch(() => {});
  void transition.finished.finally(() => root.removeAttribute("data-carrying"));
  return { pending: () => waiting };
}
