import { runMediaIndexPortContract } from '@setu/db-testing'
import { createSqliteMediaIndexPort } from '../src/index'

// Fresh :memory: DB per run — see index-contract.test.ts.
runMediaIndexPortContract(() => createSqliteMediaIndexPort(':memory:'))
