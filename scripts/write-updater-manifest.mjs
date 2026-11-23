import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function minisignLines(value) {
  return Buffer.from(value, "base64").toString("utf8").trim().split(/\r?\n/);
}

export function writeUpdaterManifest(dir, repository, tag, publicKey) {
  if (!/^v[1-9]\d*\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error("Invalid release tag.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository.");
  const version = tag.slice(1);
  const publicBytes = Buffer.from(minisignLines(publicKey ?? "")[1] ?? "", "base64");
  if (publicBytes.length !== 42) throw new Error("Invalid updater public key.");
  const files = readdirSync(dir, { withFileTypes: true }).filter((file) => file.isFile()).map((file) => file.name);
  const platforms = {};

  for (const [extension, targets] of [
    [".app.tar.gz", ["darwin-aarch64-app", "darwin-x86_64-app"]],
    [".exe", ["windows-x86_64-nsis"]],
    [".AppImage", ["linux-x86_64-appimage"]],
    [".deb", ["linux-x86_64-deb"]],
  ]) {
    const artifacts = files.filter((name) => name.endsWith(extension));
    if (artifacts.length !== 1) throw new Error(`Expected exactly one ${extension} updater asset.`);
    const [name] = artifacts;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Unsafe GitHub asset name: ${name}`);
    const signature = readFileSync(join(dir, `${name}.sig`), "utf8").trim();
    const [, encodedRecord, trustedComment] = minisignLines(signature);
    const record = Buffer.from(encodedRecord ?? "", "base64");
    // Fail the release if CI mixed up key pairs or signed a different version.
    // The Tauri client verifies the actual bytes and trusted comment before installation.
    if (record.length !== 74 || !record.subarray(2, 10).equals(publicBytes.subarray(2, 10))
      || !trustedComment?.startsWith("trusted comment: ") || !trustedComment.split("\t").includes(`version:${version}`)) {
      throw new Error(`Unexpected signing key or signed version for ${name}.`);
    }
    for (const target of targets) {
      platforms[target] = { url: `https://github.com/${repository}/releases/download/${tag}/${name}`, signature };
    }
  }
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify({ version, platforms }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeUpdaterManifest(...process.argv.slice(2, 5), process.env.TAURI_UPDATER_PUBLIC_KEY);
}
