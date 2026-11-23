import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeUpdaterManifest } from "./write-updater-manifest.mjs";

const encode = (value) => Buffer.from(value).toString("base64");
const publicKey = encode(`untrusted comment: public key\n${encode(Buffer.alloc(42, 1))}\n`);
const signature = (key, version) => encode(`untrusted comment: signature\n${encode(Buffer.alloc(74, key))}\ntrusted comment: timestamp:1\tfile:fixture\tversion:${version}\n${encode(Buffer.alloc(64))}\n`);

test("publishes a version-bound manifest for each bundle without mixing Linux installer types", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "huly-updater-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["Huly.Desk.app.tar.gz", "Huly.Desk.exe", "Huly.Desk.AppImage", "Huly.Desk.deb"]) {
    writeFileSync(join(dir, name), "fixture");
    writeFileSync(join(dir, `${name}.sig`), signature(1, "1.1.0"));
  }
  const repository = "xyunjie/huly-desktop";
  const tag = "v1.1.0";
  writeUpdaterManifest(dir, repository, tag, publicKey);
  const manifest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
  assert.equal(manifest.version, "1.1.0");
  assert.deepEqual(manifest.platforms["darwin-x86_64-app"], manifest.platforms["darwin-aarch64-app"]);
  assert.match(manifest.platforms["windows-x86_64-nsis"].url, /\.exe$/);
  assert.match(manifest.platforms["linux-x86_64-deb"].url, /\.deb$/);
  assert.match(manifest.platforms["linux-x86_64-appimage"].url, /\.AppImage$/);

  const signaturePath = join(dir, "Huly.Desk.deb.sig");
  for (const mismatched of [signature(2, "1.1.0"), signature(1, "1.0.0")]) {
    writeFileSync(signaturePath, mismatched);
    assert.throws(() => writeUpdaterManifest(dir, repository, tag, publicKey), /Unexpected signing key or signed version/);
  }
  unlinkSync(signaturePath);
  assert.throws(() => writeUpdaterManifest(dir, repository, tag, publicKey), /ENOENT/);
});
