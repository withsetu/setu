import { runSubmissionPortContract } from '@setu/db-testing'
import { createMemorySubmissionPort } from '../src/index'

runSubmissionPortContract(() => createMemorySubmissionPort())
