import type Database from "@tauri-apps/plugin-sql";
import { shuffleArray } from "../lib/shuffle";

interface RandomSampleQuery {
  columns: string;
  from: string;
  where: string;
  params: unknown[];
  /** A total order; the window is contiguous in it, so it should not cluster related rows. */
  orderBy: string;
  limit: number;
}

/**
 * Up to `limit` matching rows in random order, read as a window from a random offset that wraps
 * at the end. `ORDER BY RANDOM()` would score and sort every matching row per call.
 */
export async function selectRandomSample<T>(
  db: Pick<Database, "select">,
  { columns, from, where, params, orderBy, limit }: RandomSampleQuery,
): Promise<T[]> {
  const counted = await db.select<{ total: number }[]>(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`, params);
  const total = counted[0]?.total ?? 0;
  if (total === 0) return [];
  const window = `SELECT ${columns} FROM ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  if (total <= limit) return shuffleArray(await db.select<T[]>(window, [...params, limit, 0]));
  const offset = Math.floor(Math.random() * total);
  const head = await db.select<T[]>(window, [...params, limit, offset]);
  const wrapped = head.length < limit ? await db.select<T[]>(window, [...params, limit - head.length, 0]) : [];
  return shuffleArray([...head, ...wrapped]);
}
