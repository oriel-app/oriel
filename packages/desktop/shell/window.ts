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
