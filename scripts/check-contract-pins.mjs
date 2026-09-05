#!/usr/bin/env node
/**
 * Verify that every vendored contract in this repository still points at a
 * commit that exists and is still the head it claims to be.
 *
 * `docs/contract/openapi.yml` pins a `develop` commit; `docs/contract/pending/*.yml`
 * each pin the head of an open backend pull request. A PR head moves on every
 * force-push and `develop` moves on every merge, and when either does, the file
 * quietly starts describing a commit nobody can see any more — while reading
 * exactly as authoritative as it did the day it was written. That is the failure
 * this script exists to make loud.
 *
 * **Deliberately not part of `npm run check`.** The gate has to run offline and
 * has to be deterministic; this needs the network and an authenticated `gh`, and
 * its answer changes when the *backend* changes rather than when this repository
 * does. A gate that goes red because someone else pushed is a gate people learn
 * to ignore. Run it when refreshing a pin, before writing a story against one,
 * and before merging work that was written against one.
 *
 * Usage:  npm run contract:pins
 * Exit:   0 every pin current, 1 a pin is stale or unreadable, 2 the tooling
 *         itself could not run (no `gh`, not authenticated).
 */

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "docs/contract/openapi.yml");
const PENDING_DIR = join(ROOT, "docs/contract/pending");
const REPO = "VladislavYurin/taska-backend";

/** `#` comments only: every pin lives in a file header, never in the YAML body. */
const header = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("#"))
    .join("\n");

const gh = async (...args) => {
  const { stdout } = await run("gh", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
};

/**
 * A pin records an abbreviated commit, because that is what a reader can hold in
 * their head. Comparison is therefore by prefix, in the direction that cannot
 * produce a false pass: the recorded value must be a prefix of the live full
 * SHA, never the other way round.
 */
const matches = (recorded, live) => live.startsWith(recorded);

async function checkSnapshot(problems) {
  const text = await readFile(SNAPSHOT, "utf8");
  const recorded = /^#\s*Backend commit:\s*([0-9a-f]{7,40})\b/m.exec(header(text))?.[1];
  if (!recorded) {
    problems.push(`docs/contract/openapi.yml: no "Backend commit:" line in the header — nothing to verify against.`);
    return;
  }
  const live = await gh("api", `repos/${REPO}/branches/develop`, "--jq", ".commit.sha");
  if (matches(recorded, live)) {
    console.log(`  ok      openapi.yml               develop @ ${recorded}`);
    return;
  }
  console.log(`  STALE   openapi.yml               pinned ${recorded}, develop is now ${live.slice(0, 12)}`);
  problems.push(
    `docs/contract/openapi.yml is pinned at ${recorded} but develop has moved to ${live.slice(0, 12)}. ` +
      `Refresh it and update the header; then re-read docs/ai/API-DIVERGENCE.md, because a refresh is where ` +
      `entries go stale.`,
  );
}

async function checkPending(file, problems) {
  const text = await readFile(join(PENDING_DIR, file), "utf8");
  const head = header(text);
  const pr = /^#\s*Source:.*\/pull\/(\d+)\s*$/m.exec(head)?.[1];
  const recorded = /^#\s*Head commit:\s*([0-9a-f]{7,40})\b/m.exec(head)?.[1];

  if (!pr || !recorded) {
    problems.push(`docs/contract/pending/${file}: header is missing its "Source:" pull-request URL or its "Head commit:" line.`);
    return;
  }

  let live;
  let state;
  try {
    const raw = await gh("pr", "view", pr, "--repo", REPO, "--json", "headRefOid,state,mergeable", "--jq", "[.headRefOid,.state,.mergeable]|@tsv");
    [live, state] = raw.split("\t");
  } catch {
    console.log(`  ERROR   ${file.padEnd(25)} PR #${pr} could not be read`);
    problems.push(`docs/contract/pending/${file}: PR #${pr} could not be read. It may have been deleted, or gh is not authenticated for that repository.`);
    return;
  }

  if (state !== "OPEN") {
    console.log(`  ${state === "MERGED" ? "MERGED " : "CLOSED "} ${file.padEnd(25)} PR #${pr}`);
    problems.push(
      state === "MERGED"
        ? `docs/contract/pending/${file}: PR #${pr} has MERGED. Refresh docs/contract/openapi.yml from develop, delete this file, ` +
          `and strike its lines from docs/ai/API-DIVERGENCE.md — the housekeeping section of the README.`
        : `docs/contract/pending/${file}: PR #${pr} is ${state} without merging. Delete this file and say so in the story that was ` +
          `written against it, rather than leaving work pinned to a contract nobody will ship.`,
    );
    return;
  }

  if (matches(recorded, live)) {
    console.log(`  ok      ${file.padEnd(25)} PR #${pr} @ ${recorded}`);
    return;
  }

  console.log(`  STALE   ${file.padEnd(25)} PR #${pr} pinned ${recorded}, head is now ${live.slice(0, 12)}`);
  problems.push(
    `docs/contract/pending/${file}: pinned at ${recorded}, but PR #${pr}'s head is now ${live.slice(0, 12)}. ` +
      `Re-extract it, then re-read the story written against it — a moved head is exactly when a field name or an enum ` +
      `value changes under finished work.`,
  );
}

async function main() {
  try {
    await gh("auth", "status");
  } catch {
    console.error("gh is unavailable or not authenticated, so no pin could be verified. This script needs the network; it is not part of `npm run check` for that reason.");
    process.exit(2);
  }

  console.log("Contract pins\n");
  const problems = [];
  await checkSnapshot(problems);

  let files = [];
  try {
    files = (await readdir(PENDING_DIR)).filter((f) => f.endsWith(".yml")).sort();
  } catch {
    // No pending directory is a valid state: every backend PR has merged.
  }
  for (const file of files) await checkPending(file, problems);
  if (files.length === 0) console.log("  (no pending contracts)");

  if (problems.length === 0) {
    console.log("\nEvery pin is current.");
    return;
  }
  console.log(`\n${problems.length} pin${problems.length === 1 ? " needs" : "s need"} attention:\n`);
  for (const problem of problems) console.log(`- ${problem}\n`);
  process.exit(1);
}

await main();
