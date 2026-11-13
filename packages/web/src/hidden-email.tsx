// Hidden behind a blurred string of the same shape whose letters aren't the email's,
// so a screenshot or a screen share shows neither the email nor, unblurred, any of it.
import { useState } from "preact/hooks";
import { Tooltip } from "./tooltip.tsx";

const letters = "abcdefghjkmnpqrstuvwxyz23456789";

// Drawn from a hash of the whole: stable for one email, and nothing of it can be read back.
export function scrambled(email: string): string {
  let hash = 2166136261;
  for (const char of email) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Array.from(email, (char) => {
    if ("@.-_".includes(char)) return char;
    hash = Math.imul(hash ^ (hash >>> 13), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 16), 3266489909);
    return letters[Math.abs(hash) % letters.length]!;
  }).join("");
}

export function HiddenEmail(props: { email: string }) {
  const [shown, setShown] = useState(false);
  return (
    <Tooltip text={shown ? "Click to hide email" : "Click to show email"}>
      <button
        type="button"
        class="hidden-email"
        data-shown={shown || undefined}
        aria-label={shown ? props.email : "Hidden email"}
        onClick={() => setShown(!shown)}
      >
        {shown ? props.email : scrambled(props.email)}
      </button>
    </Tooltip>
  );
}
