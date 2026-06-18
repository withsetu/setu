import { runDataPortContract } from '@setu/db-testing'
import { createSqliteAdapter } from '../src/index'

runDataPortContract(() => createSqliteAdapter(':memory:'))
