import { openDatabase } from "@/lib/sqlite";

export const runtime = "nodejs";

export function GET() {
  const db = openDatabase(":memory:");
  try {
    const row = db.prepare("select 1 as ok").get() as { ok: number };
    return Response.json({ ok: row.ok === 1 });
  } finally {
    db.close();
  }
}
