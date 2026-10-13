import { Outlet, ScrollRestoration } from 'react-router-dom'

/**
 * The frame every route renders inside.
 *
 * WHY THIS EXISTS: a single-page app does not reset the scroll position on its
 * own. A link pressed at the bottom of one page opened the next page at the
 * same depth — so somebody who scrolled down the estimator, or tapped a footer
 * link, landed halfway down a page they had never seen, which reads as a
 * broken site. `ScrollRestoration` starts every new page at the top and still
 * puts the visitor back where they were when they press Back.
 */
export function RouteFrame() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  )
}
