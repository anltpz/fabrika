import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DB } from 'node:sqlite';

// node:sqlite yerleşik modülünü paketleyicilerden (vite/esbuild) bağımsız yükle
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import type { SaveData } from './sim/world';

export class Persistence {
  private db: DB;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated INTEGER NOT NULL
    )`);
  }

  save(code: string, data: SaveData) {
    this.db
      .prepare('INSERT INTO rooms (code, data, updated) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated = excluded.updated')
      .run(code, JSON.stringify(data), Date.now());
  }

  load(code: string): SaveData | undefined {
    const row = this.db.prepare('SELECT data FROM rooms WHERE code = ?').get(code) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as SaveData) : undefined;
  }

  exists(code: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code);
  }

  list(): Array<{ code: string; updated: number }> {
    return this.db.prepare('SELECT code, updated FROM rooms ORDER BY updated DESC LIMIT 50').all() as Array<{ code: string; updated: number }>;
  }
}
