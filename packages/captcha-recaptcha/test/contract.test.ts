import {
  runCaptchaPortContract,
  CAPTCHA_CONTRACT_SECRET
} from '@setu/captcha-testing'
import { createRecaptchaCaptcha } from '../src/index'

runCaptchaPortContract({
  // Restated here rather than imported from the adapter: an assertion that reads
  // its expected value out of the code under test can never fail (#891).
  endpoint: 'https://www.google.com/recaptcha/api/siteverify',
  makeAdapter: (fetchImpl) =>
    createRecaptchaCaptcha({ secret: CAPTCHA_CONTRACT_SECRET, fetchImpl })
})
