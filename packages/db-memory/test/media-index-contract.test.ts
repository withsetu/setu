import { runMediaIndexPortContract } from '@setu/db-testing'
import { createMemoryMediaIndexPort } from '../src/index'

runMediaIndexPortContract(() => createMemoryMediaIndexPort())
