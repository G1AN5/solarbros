/**
 * Conventional Commits configuration.
 *
 * Why enforce this: commit messages become the changelog, and a consistent
 * `type(scope): subject` format makes `git log` readable months later when
 * you are hunting for when a behaviour changed.
 *
 * Format:  type(optional scope): subject
 * Example: feat(admin): add inventory reorder alerts
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow a slightly longer subject than the 72-char default.
    'header-max-length': [2, 'always', 100],
    // Scopes are optional, but must be lower-case when present.
    'scope-case': [2, 'always', 'lower-case'],
  },
}
