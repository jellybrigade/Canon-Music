#!/usr/bin/env node
/**
 * Parse RateYourMusic Hierarchy.txt into canon-tree.json
 *
 * Input:  scripts/data/rym-hierarchy.txt, then scripts/data/custom-nodes.json appended after it,
 *         plus scripts/data/tree-renames.json, the append-only history of renamed ids
 * Output: src/assets/canon-tree.json (or stdout with --stdout)
 * Flags:  --input <txt>, --custom <json>, --renames <json> override the three inputs
 *
 * Output format: { version, renames, nodes }
 *   version: content hash of renames + nodes; the app carries stored ids when it moves
 *   renames: { from, fromName, to } with every chain resolved to the id the tree holds now
 *
 * Node format: { id, name, type, canonical_key, parents, sections }
 *   type: "genre" | "mood" | "category"
 *   sections: every section the node appears under, in SECTION_ORDER
 *   parents: direct parent ids (empty for top-level nodes)
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "src", "assets", "canon-tree.json");

function flagValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const INPUT = flagValue("--input", join(ROOT, "scripts", "data", "rym-hierarchy.txt"));
const CUSTOM = flagValue("--custom", join(ROOT, "scripts", "data", "custom-nodes.json"));
const RENAMES = flagValue("--renames", join(ROOT, "scripts", "data", "tree-renames.json"));
const TO_STDOUT = process.argv.includes("--stdout");

const SECTION_SLUGS = {
  Descriptors: "descriptors",
  Genres: "genres",
  "Scenes & Movements": "scenes-and-movements",
};

// Fixed rather than file order, so a re-scrape that reorders the sections changes nothing.
const SECTION_ORDER = ["genres", "descriptors", "scenes-and-movements"];

function addSection(node, section) {
  if (node.sections.includes(section)) return;
  node.sections.push(section);
  node.sections.sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalKey(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const lines = readFileSync(INPUT, "utf8").split("\n");

// Map from id to node. Handles DAG (same genre under multiple parents).
const nodesById = new Map();
// Stack entries: { depth, id, name }
const stack = [];
let currentSection = "genres";

for (const raw of lines) {
  if (!raw.trim()) continue;

  // Count leading spaces (4 per level)
  const leadingSpaces = raw.length - raw.trimStart().length;
  const depth = Math.floor(leadingSpaces / 4);
  const trimmed = raw.trim();

  // Depth 0 = section header (Descriptors / Genres / Scenes & Movements)
  if (depth === 0) {
    currentSection = SECTION_SLUGS[trimmed] ?? "genres";
    stack.length = 0;
    continue;
  }

  // Parse type suffix
  let name, type;
  if (trimmed.endsWith("::genre")) {
    name = trimmed.slice(0, -"::genre".length);
    type = "genre";
  } else if (trimmed.endsWith("::mood")) {
    name = trimmed.slice(0, -"::mood".length);
    type = "mood";
  } else {
    name = trimmed;
    type = "category";
  }

  // Pop stack until top depth < current depth
  while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
    stack.pop();
  }

  const parentEntry = stack.length > 0 ? stack[stack.length - 1] : null;
  const parentId = parentEntry ? parentEntry.id : null;

  const id = slugify(name);

  // Self-reference detection: tagged node whose name matches direct parent
  if (type !== "category" && parentEntry && parentEntry.name === name) {
    const parent = nodesById.get(parentId);
    if (parent && parent.type === "category") {
      parent.type = type;
    }
    // Don't create new node, don't push to stack — siblings stay parented to the bare node
    continue;
  }

  if (nodesById.has(id)) {
    // Node already exists (DAG: multiple parents). Add new parent if not already listed.
    const existing = nodesById.get(id);
    // "Hardcore [Punk]" holds "Hardcore Punk": both slug to one id, which must not parent itself.
    if (parentId && parentId !== id && !existing.parents.includes(parentId)) {
      existing.parents.push(parentId);
    }
    if (existing.type === "category" && type !== "category") {
      existing.type = type;
    }
    addSection(existing, currentSection);
    // Push to stack so its children use it as parent
    stack.push({ depth, id, name });
  } else {
    const node = {
      id,
      name,
      type,
      canonical_key: canonicalKey(name),
      parents: parentId ? [parentId] : [],
      sections: [currentSection],
    };
    nodesById.set(id, node);
    stack.push({ depth, id, name });
  }
}

// Nodes RYM does not have. Appended here so the parser stays the tree's only writer.
for (const custom of JSON.parse(readFileSync(CUSTOM, "utf8"))) {
  if (nodesById.has(custom.id)) {
    throw new Error(`custom node "${custom.id}" already exists in ${INPUT}; drop it from ${CUSTOM}`);
  }
  for (const parent of custom.parents) {
    if (!nodesById.has(parent)) {
      throw new Error(`custom node "${custom.id}" names missing parent "${parent}"`);
    }
  }
  nodesById.set(custom.id, custom);
}

// A rename is refused unless it leaves the tree for good and lands on a node that exists, so
// the app never carries a user's mapping onto an id nothing resolves.
function resolveRenames(history) {
  const targets = new Map();
  for (const { from, fromName, to } of history) {
    if (targets.has(from)) throw new Error(`"${from}" is renamed twice in ${RENAMES}`);
    targets.set(from, { fromName, to });
  }
  return [...targets].map(([from, { fromName }]) => {
    if (nodesById.has(from)) throw new Error(`rename source "${from}" is still in the tree`);
    const seen = new Set([from]);
    let to = from;
    while (targets.has(to)) {
      to = targets.get(to).to;
      if (seen.has(to)) throw new Error(`rename cycle through "${from}"`);
      seen.add(to);
    }
    if (!nodesById.has(to)) throw new Error(`rename target "${to}" is not in the tree (from "${from}")`);
    return { from, fromName, to };
  });
}

const renames = resolveRenames(JSON.parse(readFileSync(RENAMES, "utf8")));
const nodes = Array.from(nodesById.values());
const version = createHash("sha256").update(JSON.stringify({ renames, nodes })).digest("hex").slice(0, 16);
const json = JSON.stringify({ version, renames, nodes }, null, 2);

if (TO_STDOUT) {
  process.stdout.write(json);
} else {
  writeFileSync(OUTPUT, json);
  console.log(`Parsed ${nodes.length} nodes`);
  console.log(`  genre: ${nodes.filter((n) => n.type === "genre").length}`);
  console.log(`  mood: ${nodes.filter((n) => n.type === "mood").length}`);
  console.log(`  category: ${nodes.filter((n) => n.type === "category").length}`);
  console.log(`  renames: ${renames.length}`);
  console.log(`Written to ${OUTPUT} (version ${version})`);
}
