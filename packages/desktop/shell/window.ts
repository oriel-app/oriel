// How the shell sets up the window's engine, apart from where the window may
// go (main.ts, guard): its renderers' preferences and its session's refusals.
// `pnpm sketch-frames --desktop`'s probe build (packages/desktop/probe/)
// takes them from here too, so the probes meet the engine as the app sets
// it up. The shell also calls `app.enableSandbox()` before Electron is ready.
import type { Session, WebPreferences } from "electron";
import { mayUse } from "./rules.ts";

export const webPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  devTools: false,
} as const satisfies WebPreferences;

// Every permission refused but what rules.ts allows the server's origin,
// every device refused, and every download stopped.
export function lockSession(own: Session, origin: () => string | null): void {
  own.setPermissionRequestHandler((_contents, permission, decide, details) =>
    decide(mayUse(permission, details.requestingUrl, origin())),
  );
  own.setPermissionCheckHandler((_contents, permission, requesting) =>
    mayUse(permission, requesting, origin()),
  );
  own.setDevicePermissionHandler(() => false);
  own.on("will-download", (event) => event.preventDefault());
}
