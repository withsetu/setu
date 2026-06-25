import { runSubmissionPortContract } from '@setu/db-testing'
import { createSqliteSubmissionPort } from '../src/index'

runSubmissionPortContract(() => createSqliteSubmissionPort(':memory:'))
