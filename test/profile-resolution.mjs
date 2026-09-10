// Regression test for the DSH profile-relative package resolution in
// cordis.patch.yml. The old URL-relative expression points at <profile>/mcp;
// the fixed expression resolves the installed package through package.json.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "dsh-wincu-profile-"));
const profileDir = path.join(fixtureRoot, "profile");
const packageDir = path.join(profileDir, "node_modules", "dsh-computer-use-win");
const serverPath = path.join(packageDir, "mcp", "server.mjs");

try {
  await mkdir(path.dirname(serverPath), { recursive: true });
  await writeFile(path.join(profileDir, "package.json"), JSON.stringify({ name: "fixture-profile" }));
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    name: "dsh-computer-use-win",
    version: "0.0.0",
    main: "mcp/server.mjs",
  }));
  await writeFile(serverPath, "export {};\n");

  // DSH sets baseUrl to the directory containing cordis.yml.
  const baseUrl = pathToFileURL(path.join(profileDir, "cordis.yml")).href;
  const oldPath = fileURLToPath(new URL("mcp/server.mjs", baseUrl));
  const resolvedPath = createRequire(new URL("package.json", baseUrl))
    .resolve("dsh-computer-use-win/mcp/server.mjs");

  assert.equal(path.normalize(oldPath), path.join(profileDir, "mcp", "server.mjs"));
  assert.notEqual(oldPath, serverPath);
  assert.equal(path.normalize(resolvedPath), path.normalize(serverPath));

  const patchPath = fileURLToPath(new URL("../cordis.patch.yml", import.meta.url));
  const patch = await readFile(patchPath, "utf8");
  assert.match(
    patch,
    /createRequire\(new URL\('package\.json', baseUrl\)\)\.resolve\('dsh-computer-use-win\/mcp\/server\.mjs'\)/,
  );

  console.log(JSON.stringify({
    ok: true,
    oldPath,
    resolvedPath,
    packageSpecifier: "dsh-computer-use-win/mcp/server.mjs",
  }, null, 2));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
