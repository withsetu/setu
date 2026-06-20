import { runIndexPortContract } from '@setu/db-testing'
import { createMemoryIndexPort } from '../src/index'

runIndexPortContract(() => createMemoryIndexPort())
