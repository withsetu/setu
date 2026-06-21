import 'fake-indexeddb/auto'
import { runMediaIndexPortContract } from '@setu/db-testing'
import { createIdbMediaIndexPort } from '../src/index'

let n = 0
runMediaIndexPortContract(() => createIdbMediaIndexPort(`setu-media-index-test-${n++}`))
