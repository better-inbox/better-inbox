import type { AuthContext, Where } from "better-auth";

// Cloudflare D1 binds at most 100 parameters per query, so `in` lists are split
// into chunks that leave room for the rest of the where clause
export const IN_CHUNK = 90;

// findMany returns 100 rows unless given a limit
const FIND_PAGE = 1000;

export function chunk<T>(values: T[], size = IN_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

/**
 * Every row whose `field` is one of `values`, however many values or matching
 * rows there are.
 */
export async function findManyIn<T>(
  context: AuthContext,
  {
    model,
    field,
    values,
    where = [],
    select,
  }: {
    model: string;
    field: string;
    values: string[];
    where?: Where[];
    select?: string[];
  },
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunk([...new Set(values)])) {
    for (let offset = 0; ; offset += FIND_PAGE) {
      const page = await context.adapter.findMany<T>({
        model,
        where: [...where, { field, operator: "in", value: part }],
        limit: FIND_PAGE,
        offset,
        sortBy: { field: "id", direction: "asc" },
        ...(select ? { select } : {}),
      });
      rows.push(...page);
      if (page.length < FIND_PAGE) break;
    }
  }
  return rows;
}
