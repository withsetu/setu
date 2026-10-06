import {
  runSubmissionPortContract,
  runSubmissionPortPagingClampContract
} from '@setu/db-testing'
import { createMemorySubmissionPort } from '../src/index'

runSubmissionPortContract(() => createMemorySubmissionPort())
runSubmissionPortPagingClampContract(() => createMemorySubmissionPort())
