import type { StockItem } from '@/types/domain'

/* ============================================================================
   HOW LOW IS LOW
   ----------------------------------------------------------------------------
   Inventory and Purchasing each decided this for themselves — one with "<",
   the other with "<=" — so an item could read "Healthy" on one page and
   "Order these" on the next. One rule, used by both:

     oversold  more is promised to projects than the warehouse holds
     reorder   free stock at or below the item's reorder point
     low       within the early-warning band above it — reorder point ×
               `inventory.low_stock_warning_multiplier` — time to plan an order
     healthy   everything else

   An item whose reorder point is 0 is one the company does not keep in stock,
   so running out of it is not a warning.
   ========================================================================== */

export type StockLevel = 'oversold' | 'reorder' | 'low' | 'healthy'

export function stockLevel(item: StockItem, warningMultiplier = 1.5): StockLevel {
  const free = item.onHand - item.reserved
  if (free < 0) return 'oversold'
  if (item.reorderPoint <= 0) return 'healthy'
  if (free <= item.reorderPoint) return 'reorder'
  if (free <= item.reorderPoint * Math.max(1, warningMultiplier)) return 'low'
  return 'healthy'
}
