import { runCaptchaPortContract } from '@setu/db-testing'
import { createRecaptchaCaptcha } from '../src/index'

runCaptchaPortContract((fetchImpl) =>
  createRecaptchaCaptcha({ secret: 'secret', fetchImpl })
)
