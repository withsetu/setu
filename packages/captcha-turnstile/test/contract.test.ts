import { runCaptchaPortContract } from '@setu/db-testing'
import { createTurnstileCaptcha } from '../src/index'

runCaptchaPortContract((fetchImpl) => createTurnstileCaptcha({ secret: 'secret', fetchImpl }))
