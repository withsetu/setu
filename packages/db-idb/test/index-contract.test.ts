import 'fake-indexeddb/auto'
import { runIndexPortContract } from '@setu/db-testing'
import { createIdbIndexPort } from '../src/index'

let n = 0
runIndexPortContract(() => createIdbIndexPort(`setu-index-test-${n++}`))
