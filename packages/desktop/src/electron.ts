// The Electron release the desktop app's shell runs on (decision 0039), taken
// without npm: the official zip from the release on GitHub, checked against
// these hashes, which come from that release's SHASUMS256.txt. The version is
// at least 7 days old when pinned, as pnpm's rule asks of every package. Its
// types are `vendor/electron.d.ts`, the release's own, under the same rule.
export const electronVersion = "45.0.0";

// The Node inside that release, which the server runs on (decision 0047).
// mise.toml pins the same version, so CI and `pnpm dev` test what the app
// runs; a bump of Electron moves both.
export const electronNode = "24.22.0";

export const electronZips = {
  "darwin-arm64": "896c3a50b148e89a158dca08a6996a022ddf39b23aac871e107f5b4087f8caa9",
  "darwin-x64": "7877c282e74a52f8d87949536a25735cf9982de1265b544c9cd258dd14eff4de",
  "linux-arm64": "a80d92b1ad6c111545a12632b8a75cedce614a41866e500810d4050d947f90e9",
  "linux-x64": "22f6a10bd3f7fef987ddbb379d3375ce664ad0c98a9a50f80c89f1718a0c3e3a",
  "win32-arm64": "fbae273960b24b81ab7a5cdcf34dd83a8781ee6799ccc621c1d85d5ce197252d",
  "win32-x64": "ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47",
} as const;

export const electronTypes = "3904ba28705010e74b57b282c604a81e1295a4101d26c320e9765fa16fd3d2de";

export type Target = keyof typeof electronZips;

export function target(platform: string, arch: string): Target {
  const name = `${platform}-${arch}`;
  if (!Object.hasOwn(electronZips, name))
    throw new Error(`Electron has no build pinned for ${name}`);
  return name as Target;
}

export function zipName(on: Target): string {
  return `electron-v${electronVersion}-${on}.zip`;
}

export function zipUrl(on: Target): string {
  return `https://github.com/electron/electron/releases/download/v${electronVersion}/${zipName(on)}`;
}
