/* ============================================================================
   TURNING DATABASE ERRORS INTO SENTENCES
   ----------------------------------------------------------------------------
   A member of staff accepted a quotation and was shown:

     new row for relation "contracts" violates check constraint
     "contracts_contract_value_check"

   That is a true statement and a useless one. It names a table and a constraint
   rather than the thing that is wrong, it gives no way to fix it, and it leaks
   the schema to anybody who can provoke it.

   WHY THIS IS NOT ONLY A WORDING PROBLEM
   A constraint firing means the interface let somebody reach a state the
   database forbids — here, a quotation worth nothing. The message should say
   what went wrong, but the real fix is upstream, where the impossible state was
   allowed. So each entry below names the cause in business terms AND the pages
   that produce it have their own guard; this is the safety net, not the plan.

   A public version of this already existed in public-forms.ts, used only by the
   three anonymous forms. Every staff mutation threw the raw Supabase error
   straight at the screen, which is why this one reached a person.
   ========================================================================== */

interface DbError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

/* SQLSTATEs carrying a message written FOR the reader.

   `22023` and `53400` are raised deliberately by our own functions for
   validation and rate limiting. `42501` is row-level security refusing — the
   functions raise it with sentences like "Not your project." */
const SAFE_TO_SHOW = new Set(['22023', '53400', '42501', 'P0002'])

/* Constraint name -> what actually went wrong, in the reader's terms.

   Keyed on the constraint rather than the message text, because the text is
   Postgres's and changes between versions while the name is ours. */
const BY_CONSTRAINT: Record<string, string> = {
  contracts_contract_value_check:
    'This quotation is worth ₱0, so there is nothing to put in a contract. That usually means the stock catalogue is empty, so the bill of materials priced at nothing — add your equipment under Inventory, then rebuild the quotation.',
  contracts_stages_total_100:
    'The payment stages in Business Settings do not add up to 100%. Fix them before raising a contract.',
  contracts_executed_needs_both_signatures:
    'A contract cannot be marked executed until both the customer and the company have signed it.',

  invoices_amount_check: 'An invoice has to be for more than ₱0.',
  payments_amount_check: 'A payment has to be for more than ₱0.',
  payment_refunds_amount_check: 'A refund has to be for more than ₱0.',

  quotation_lines_quantity_check: 'Every line on a quotation needs a quantity above zero.',
  quotations_discount_pct_check: 'A discount has to be between 0% and 100%.',

  stock_items_on_hand_check:
    'That would take the stock on hand below zero. Check the quantity — you may be issuing more than you hold.',
  stock_items_reserved_check:
    'That would reserve less than nothing. The reservation may already have been released.',
  stock_reservations_quantity_check: 'A reservation needs a quantity above zero.',
  stock_movements_quantity_check: 'A stock movement of zero would record nothing.',

  purchase_order_lines_quantity_check:
    'Every line on a purchase order needs a quantity above zero.',
  purchase_orders_total_amount_check: 'A purchase order cannot be for a negative amount.',

  packages_size_kw_check: 'A package needs an array size above zero.',
  packages_price_from_check: 'A package price cannot be negative.',

  profiles_pkey: 'That account already exists.',
  serialised_assets_serial_number_key:
    'That serial number is already recorded against another installation.',
  booking_blackouts_pkey: 'That date is already closed.',
}

/** Pull the constraint name out of whichever field Postgres put it in. */
function constraintOf(error: DbError): string | undefined {
  const haystack = `${error.message} ${error.details ?? ''}`
  const match = haystack.match(/constraint "([^"]+)"/)
  return match?.[1]
}

export function readableDbError(error: DbError): Error {
  if (error.code && SAFE_TO_SHOW.has(error.code)) {
    return new Error(error.message)
  }

  const constraint = constraintOf(error)
  if (constraint && BY_CONSTRAINT[constraint]) {
    return new Error(BY_CONSTRAINT[constraint])
  }

  /* The three classes worth naming even when the constraint is unknown, because
     each tells the reader something they can act on. */
  switch (error.code) {
    case '23505':
      return new Error('That already exists. Check whether it has been added before.')
    case '23503':
      return new Error(
        'Something this record depends on is missing, or something still depends on it. It cannot be removed while it is in use.',
      )
    case '23514':
      return new Error(
        'One of the values is outside what the system allows. Check the amounts and quantities.',
      )
    case '23502':
      return new Error('Something required was left blank.')
    default:
      break
  }

  /* Anything else is a fault rather than a mistake. The text is kept in
     development, where somebody can act on it, and replaced in production,
     where it would only leak the schema. */
  return new Error(
    import.meta.env.DEV
      ? `${error.message}${error.code ? ` (code ${error.code})` : ''}`
      : 'Something went wrong at our end. Nothing was saved. Please try again.',
  )
}

/**
 * Throw a readable error when Supabase returned one.
 *
 * `if (error) throwReadable(error)` replaces `if (error) throw error` at a
 * mutation's edge, which is the only place the raw object should ever exist.
 */
export function throwReadable(error: DbError | null): asserts error is null {
  if (error) throw readableDbError(error)
}
