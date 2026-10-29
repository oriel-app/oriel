// An addition to decision 0006 (see 0017). The heap cap
// (`--max-old-space-size`) doesn't bound memory outside the V8 heap: array
// buffers, WebAssembly memories and each worker's own heap. So the host also
// samples the process's resident memory and stops it when over. Sampling
// can overshoot the cap by whatever the guest allocates in one interval.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export async function residentBytes(pid: number): Promise<number | null> {
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
    const kb = /^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1];
    return kb === undefined ? null : Number(kb) * 1024;
  }
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "rss=", "-p", String(pid)], { env: {} }, (error, stdout) => {
      const kb = Number.parseInt(stdout, 10);
      resolve(error || Number.isNaN(kb) ? null : kb * 1024);
    });
  });
}

// Samples every `everyMs` until stopped, and calls `over` once if the process
// passes `limitBytes`. Returns the stop function.
export function watchMemory(
  pid: number,
  limitBytes: number,
  everyMs: number,
  over: (bytes: number) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sample = async () => {
    const bytes = await residentBytes(pid);
    if (stopped) return;
    if (bytes !== null && bytes > limitBytes) {
      over(bytes);
      return;
    }
    timer = setTimeout(sample, everyMs);
  };
  timer = setTimeout(sample, everyMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
