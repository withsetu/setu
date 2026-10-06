import {
  runSubmissionPortContract,
  runSubmissionPortPagingClampContract
} from '@setu/db-testing'
import { createSqliteSubmissionPort } from '../src/index'

runSubmissionPortContract(() => createSqliteSubmissionPort(':memory:'))
runSubmissionPortPagingClampContract(() =>
  createSqliteSubmissionPort(':memory:')
)
