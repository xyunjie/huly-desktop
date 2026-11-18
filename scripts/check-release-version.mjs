import { readFileSync, writeFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const write = (file, content) => writeFileSync(new URL(`../${file}`, import.meta.url), content);
const manifest = JSON.parse(read("package.json"));
const [requestedTag, mode] = process.argv.slice(2);
const tag = requestedTag || `v${manifest.version}`;

if (!/^v[1-9]\d*\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
  throw new Error(`发布标签必须采用 vX.Y.Z 格式，且从 v1.0.0 开始：${JSON.stringify(tag)}`);
}

const expected = tag.slice(1);
const npmLock = JSON.parse(read("package-lock.json"));
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m;
const cargoLockVersion = /^(name = "huly-desk"\r?\nversion = )"([^"]+)"/m;
const versions = {
  "package.json": manifest.version,
  "package-lock.json": npmLock.version,
  "package-lock.json 根包": npmLock.packages?.[""]?.version,
  "src-tauri/tauri.conf.json": tauri.version,
  "src-tauri/Cargo.toml": cargo.match(cargoVersion)?.[1],
  "src-tauri/Cargo.lock": cargoLock.match(cargoLockVersion)?.[2],
};

const apply = mode === "--apply" && Boolean(requestedTag);
for (const [file, version] of Object.entries(versions)) {
  const base = apply ? manifest.version : expected;
  if (!version || version !== base) throw new Error(`${file} 的版本 ${version ?? "未找到"} 与预期版本 ${base} 不一致。`);
}

// CI uses the tag as the release version in its checkout. It does not modify
// the branch or publish another tag.
if (apply && manifest.version !== expected) {
  const writeJson = (file, json) => write(file, JSON.stringify(json, null, 2) + "\n");
  manifest.version = npmLock.version = npmLock.packages[""].version = tauri.version = expected;
  writeJson("package.json", manifest);
  writeJson("package-lock.json", npmLock);
  writeJson("src-tauri/tauri.conf.json", tauri);
  write("src-tauri/Cargo.toml", cargo.replace(cargoVersion, `version = "${expected}"`));
  write("src-tauri/Cargo.lock", cargoLock.replace(cargoLockVersion, (_, prefix) => `${prefix}"${expected}"`));
}
console.log(`版本一致：${tag}`);
