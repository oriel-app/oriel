// A chat follows what arrives only while the person is at its latest entry
// (OA-350). Reading further up, they stay where they are, and this pill over
// the composer says something came; it takes them there, as reaching the
// latest by hand does, and goes. A thread's page and the window chat both
// draw it, from `unseen` in thread.ts.
export function NewMessage({ onShow }: { onShow(): void }) {
  return (
    <button type="button" class="new-message-pill" onClick={onShow}>
      <span aria-hidden="true">↓</span>New message
    </button>
  );
}
