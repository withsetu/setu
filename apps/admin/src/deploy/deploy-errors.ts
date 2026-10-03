// Its own module (not deploy.tsx) so tests that mock the provider module keep the real class.

/** rebuild() lost sight of a build it started: the status poll failed, so whether the build
 *  finished, failed, or was interrupted is unknown. Distinct from a build that FAILED, so the
 *  caller never reports "Rebuild failed" for an outcome it does not know (#1157). */
export class DeployOutcomeUnknownError extends Error {
  override name = 'DeployOutcomeUnknownError'
}
