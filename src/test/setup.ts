/**
 * Vitest setup — runs once before the test suite.
 *
 * Adds jest-dom's custom matchers so component tests can assert things like
 * `expect(button).toBeInTheDocument()` and `expect(input).toBeDisabled()`.
 */
import '@testing-library/jest-dom/vitest'
