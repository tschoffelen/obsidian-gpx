import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2];
if (!targetVersion) {
	console.error("Usage: node version-bump.mjs <version>");
	process.exit(1);
}

const writeJson = (path, data) =>
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeJson("manifest.json", manifest);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeJson("versions.json", versions);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = targetVersion;
writeJson("package.json", pkg);
