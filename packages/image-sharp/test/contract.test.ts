import { runImagePortContract } from '@setu/image-testing'
import { createSharpImageAdapter } from '../src/index'

runImagePortContract(() => createSharpImageAdapter())
