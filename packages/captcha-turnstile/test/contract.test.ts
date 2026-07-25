import {
  runCaptchaPortContract,
  CAPTCHA_CONTRACT_SECRET
} from '@setu/captcha-testing'
import { createTurnstileCaptcha } from '../src/index'

runCaptchaPortContract({
  // Restated here rather than imported from the adapter: an assertion that reads
  // its expected value out of the code under test can never fail (#891).
  endpoint: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  makeAdapter: (fetchImpl) =>
    createTurnstileCaptcha({ secret: CAPTCHA_CONTRACT_SECRET, fetchImpl })
})
