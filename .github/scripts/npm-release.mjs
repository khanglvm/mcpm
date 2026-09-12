import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(readFileSync(process.argv[2] ?? "package.json", "utf8"));
const { name, version } = manifest;
if (!name || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("A package name and valid release version are required");
}
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Tag ${process.env.GITHUB_REF_NAME} must match package version v${version}`);
}
let versionChanged = true;
if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF_TYPE === "branch") {
  const { before } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (!before) throw new Error("Push event is missing its previous commit");
  if (!/^0+$/.test(before)) {
    const previous = spawnSync("git", ["show", `${before}:package.json`], { encoding: "utf8" });
    if (previous.status !== 0) throw new Error("Cannot read the previous package version");
    versionChanged = JSON.parse(previous.stdout).version !== version;
  }
}
const result = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json", "--registry=https://registry.npmjs.org"], { encoding: "utf8" });
if (result.error) throw result.error;
let response;
try { response = JSON.parse(result.stdout); } catch { throw new Error(`Cannot read registry response (exit ${result.status}): ${result.stderr || result.stdout}`); }
let exists;
if (result.status === 0 && response === version) exists = true;
else if (result.status !== 0 && response?.error?.code === "E404") exists = false;
else throw new Error(`Registry lookup failed: ${JSON.stringify(response)}`);
const dryRun = process.env.DRY_RUN === "true";
const distTag = version.split("+")[0].includes("-") ? "next" : "latest";
const outputs = { name, version, dist_tag: distTag, exists, version_changed: versionChanged, publish: versionChanged && !exists, validate: dryRun || (versionChanged && !exists) };
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
}
console.log(JSON.stringify(outputs));
if (exists) console.log(`${name}@${version} already exists; publication will be skipped.`);
