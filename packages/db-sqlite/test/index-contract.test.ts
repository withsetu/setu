import { runIndexPortContract } from '@setu/db-testing'
import { createSqliteIndexPort } from '../src/index'

// ':memory:' gives every contract run a fresh, empty database (each
// better-sqlite3 :memory: connection is its own DB) — mirrors db-idb's
// fresh-DB-name-per-run construction.
runIndexPortContract(() => createSqliteIndexPort(':memory:'))
