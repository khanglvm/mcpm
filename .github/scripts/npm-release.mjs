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
const result = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json", "--registry=https://registry.npmjs.org"], { encoding: "utf8" });
if (result.error) throw result.error;
let response;
try { response = JSON.parse(result.stdout); } catch { throw new Error(`Cannot read registry response (exit ${result.status}): ${result.stderr || result.stdout}`); }
let exists;
if (result.status === 0 && response === version) exists = true;
else if (result.status !== 0 && response?.error?.code === "E404") exists = false;
else throw new Error(`Registry lookup failed: ${JSON.stringify(response)}`);
const dryRun = process.env.DRY_RUN === "true";
const distTag = version.includes("-") ? "next" : "latest";
const outputs = { name, version, dist_tag: distTag, exists, validate: dryRun || !exists };
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
}
console.log(JSON.stringify(outputs));
if (exists) console.log(`${name}@${version} already exists; publication will be skipped.`);
