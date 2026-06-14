import { runDataPortContract } from '@saytu/db-testing'
import { createSqliteAdapter } from '../src/index'

runDataPortContract(() => createSqliteAdapter(':memory:'))
