export function NewMessage({ onShow }: { onShow(): void }) {
  return (
    <button type="button" class="new-message-pill" onClick={onShow}>
      <span aria-hidden="true">↓</span>New message
    </button>
  );
}
