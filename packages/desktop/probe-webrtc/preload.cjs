// The preload lever (webrtc-frame-spike): in every frame it runs in, take
// RTCPeerConnection, and its legacy alias, off the page's own world before
// the page's scripts run. A sandboxed preload may require only part of
// Electron; contextBridge.executeInMainWorld runs synchronously.
const { contextBridge } = require("electron");
contextBridge.executeInMainWorld({
  func: () => {
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
      try {
        delete globalThis[name];
      } catch {}
    }
  },
});
