import { Database, type DatabaseAdapter } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { librarySchema } from './schema';
import { models } from './models';

let db: Database | null = null;

/**
 * App-wide database singleton backed by SQLite (JSI). Lazy: the first
 * library screen touch instantiates it. Tests inject their own LokiJS
 * database through `createDatabase`.
 *
 * If the on-device DB cannot be opened (schema mismatch after an upgrade),
 * reset it so the app recovers instead of failing permanently.
 */
export function getDatabase(): Database {
  if (!db) {
    db = createDatabase(
      new SQLiteAdapter({
        schema: librarySchema,
        jsi: true,
        onSetUpError: async () => {
          // Schema mismatch or corrupt DB; wipe and recreate.
          try {
            await db?.adapter.unsafeResetDatabase();
          } finally {
            db = null;
          }
        },
      }),
    );
  }
  return db;
}

export function createDatabase(adapter: DatabaseAdapter): Database {
  return new Database({ adapter, modelClasses: models });
}

export async function resetDatabase(): Promise<void> {
  if (!db) return;
  await db.adapter.unsafeResetDatabase();
  db = null;
}
