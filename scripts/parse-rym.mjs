#!/usr/bin/env node
/**
 * Parse RateYourMusic Hierarchy.txt into canon-tree.json
 *
 * Input:  scripts/data/rym-hierarchy.txt
 * Output: src/assets/canon-tree.json
 *
 * Node format: { id, name, type, canonical_key, parents, section }
 *   type: "genre" | "mood" | "category"
 *   section: "genres" | "descriptors" | "scenes-and-movements"
 *   parents: direct parent ids (empty for top-level nodes)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INPUT = join(ROOT, "scripts", "data", "rym-hierarchy.txt");
const OUTPUT = join(ROOT, "src", "assets", "canon-tree.json");

const SECTION_SLUGS = {
  Descriptors: "descriptors",
  Genres: "genres",
  "Scenes & Movements": "scenes-and-movements",
};

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
    if (parentId && !existing.parents.includes(parentId)) {
      existing.parents.push(parentId);
    }
    if (existing.type === "category" && type !== "category") {
      existing.type = type;
    }
    // Push to stack so its children use it as parent
    stack.push({ depth, id, name });
  } else {
    const node = {
      id,
      name,
      type,
      canonical_key: canonicalKey(name),
      parents: parentId ? [parentId] : [],
      section: currentSection,
    };
    nodesById.set(id, node);
    stack.push({ depth, id, name });
  }
}

const nodes = Array.from(nodesById.values());
console.log(`Parsed ${nodes.length} nodes`);
console.log(`  genre: ${nodes.filter((n) => n.type === "genre").length}`);
console.log(`  mood: ${nodes.filter((n) => n.type === "mood").length}`);
console.log(`  category: ${nodes.filter((n) => n.type === "category").length}`);

writeFileSync(OUTPUT, JSON.stringify({ nodes }, null, 2));
console.log(`Written to ${OUTPUT}`);
