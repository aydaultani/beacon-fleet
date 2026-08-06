/**
 * Minimal ambient types for `node:sqlite` — not yet shipped by @types/node
 * even at the latest 22.x as of this writing (the API itself is stable
 * enough to use behind the ExperimentalWarning, just undocumented in
 * types). Covers only the surface this codebase actually calls; expand as
 * needed rather than pulling in a third-party type package for one module.
 */
declare module "node:sqlite" {
  export interface RunResult {
    lastInsertRowid: number | bigint;
    changes: number | bigint;
  }

  export interface StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
