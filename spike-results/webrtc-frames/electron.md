Engines: Electron 45.0.0 (Chromium 156.0.8078.48), the app's framework 7fc7343c22b3…; Electron 45.0.0 (Chromium 156.0.8078.48), the app's framework 7fc7343c22b3…, switches --force-webrtc-ip-handling-policy=disable_non_proxied_udp; Electron 45.0.0 (Chromium 156.0.8078.48), the app's framework 7fc7343c22b3…, switches --webrtc-ip-handling-policy=disable_non_proxied_udp; Electron 45.0.0 (Chromium 156.0.8078.48), the app's framework 7fc7343c22b3…, switches --enforce-webrtc-ip-permission-check

Permissions-Policy features with "rtc" or "peer" in the name: [] (of ?)

| levers | frame | variant | API | stun | turn-udp | turn-tcp | turn-tls | peer-udp | peer-tcp | stun-dns | turn-dns | ice-dns | ice-tcp-dns | own fetch | bridge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| none | sandboxed | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | srcdoc | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| none | srcdoc | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | data | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| none | data | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | blob | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| none | blob | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| none | partition | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | n/a |
| none | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| none | partition | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | n/a |
| csp | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| csp | sandboxed | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | srcdoc | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| csp | srcdoc | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | data | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| csp | data | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | blob | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| csp | blob | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| csp | partition | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | n/a |
| csp | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| csp | partition | child-srcdoc | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | n/a |
| policy | sandboxed | direct | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy | sandboxed | child-srcdoc | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | srcdoc | direct | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy | srcdoc | child-srcdoc | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | data | direct | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy | data | child-srcdoc | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | blob | direct | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy | blob | child-srcdoc | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | ok |
| policy | partition | direct | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | n/a |
| policy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy | partition | child-srcdoc | yes | · | · | LEAK | reach | · | LEAK | · | DNS+LEAK | DNS | DNS | ok | n/a |
| preload | sandboxed | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | sandboxed | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | srcdoc | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | srcdoc | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | data | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | data | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | blob | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | blob | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| preload | partition | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| preload | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| preload | partition | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| proxy | sandboxed | direct | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| proxy | sandboxed | child-srcdoc | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | srcdoc | direct | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| proxy | srcdoc | child-srcdoc | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | data | direct | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| proxy | data | child-srcdoc | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | blob | direct | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| proxy | blob | child-srcdoc | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | ok |
| proxy | partition | direct | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | n/a |
| proxy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| proxy | partition | child-srcdoc | yes | reach | LEAK | proxy | proxy | LEAK | proxy | DNS | DNS+proxy | DNS | DNS | ok | n/a |
| policy+proxy | sandboxed | direct | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+proxy | sandboxed | child-srcdoc | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | srcdoc | direct | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+proxy | srcdoc | child-srcdoc | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | data | direct | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+proxy | data | child-srcdoc | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | blob | direct | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+proxy | blob | child-srcdoc | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | ok |
| policy+proxy | partition | direct | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | n/a |
| policy+proxy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+proxy | partition | child-srcdoc | yes | · | · | proxy | proxy | · | proxy | · | DNS+proxy | DNS | DNS | ok | n/a |
| deadproxy | sandboxed | direct | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| deadproxy | sandboxed | child-srcdoc | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | srcdoc | direct | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| deadproxy | srcdoc | child-srcdoc | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | data | direct | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| deadproxy | data | child-srcdoc | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | blob | direct | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| deadproxy | blob | child-srcdoc | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | ok |
| deadproxy | partition | direct | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | n/a |
| deadproxy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| deadproxy | partition | child-srcdoc | yes | reach | LEAK | · | · | LEAK | · | DNS | DNS | DNS | DNS | ok | n/a |
| policy+deadproxy | sandboxed | direct | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+deadproxy | sandboxed | child-srcdoc | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | srcdoc | direct | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+deadproxy | srcdoc | child-srcdoc | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | data | direct | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+deadproxy | data | child-srcdoc | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | blob | direct | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+deadproxy | blob | child-srcdoc | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | ok |
| policy+deadproxy | partition | direct | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | n/a |
| policy+deadproxy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+deadproxy | partition | child-srcdoc | yes | · | · | · | · | · | · | · | DNS | DNS | DNS | ok | n/a |
| policy+preload | sandboxed | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | sandboxed | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | srcdoc | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | srcdoc | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | data | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | data | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | blob | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | blob | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload | partition | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+preload | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+preload | partition | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+preload+proxy | sandboxed | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | sandboxed | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | sandboxed | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | srcdoc | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | srcdoc | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | srcdoc | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | data | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | data | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | data | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | blob | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | blob | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | blob | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | ok |
| policy+preload+proxy | partition | direct | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+preload+proxy | partition | child-blank | Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame. | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| policy+preload+proxy | partition | child-srcdoc | gone | · | · | · | · | · | · | · | · | · | · | ok | n/a |
| --force-webrtc-ip-handling-policy | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| --webrtc-ip-handling-policy | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| fence set from code | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |
| --enforce-webrtc-ip-permission-check | sandboxed | direct | yes | reach | LEAK | LEAK | reach | LEAK | LEAK | DNS | DNS+LEAK | DNS | DNS | ok | ok |

Errors the probes reported:
- api: Failed to read a named property 'RTCPeerConnection' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame.

Permissions asked: ["check background-sync","check media"]

Proxy refusals (sample): ["CONNECT 127.0.0.1:<port>","CONNECT q61ztd.exfil.test:<port>","CONNECT q63ztd.exfil.test:<port>","CONNECT q64ztd.exfil.test:<port>","CONNECT q66ztd.exfil.test:<port>","CONNECT q67ztd.exfil.test:<port>","CONNECT q69ztd.exfil.test:<port>","CONNECT q70ztd.exfil.test:<port>","CONNECT q72ztd.exfil.test:<port>","CONNECT q73ztd.exfil.test:<port>","CONNECT q75ztd.exfil.test:<port>","CONNECT q76ztd.exfil.test:<port>","CONNECT q78ztd.exfil.test:<port>","CONNECT q79ztd.exfil.test:<port>","CONNECT q81ztd.exfil.test:<port>","CONNECT q82ztd.exfil.test:<port>","CONNECT q84ztd.exfil.test:<port>","CONNECT q85ztd.exfil.test:<port>","CONNECT q87ztd.exfil.test:<port>","CONNECT q88ztd.exfil.test:<port>","CONNECT q90ztd.exfil.test:<port>"]