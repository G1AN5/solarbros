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

/**
 * An error that is worth trying again — the request never reached the
 * database, so nothing was refused and nothing was saved.
 *
 * WHY THIS IS A FLAG AND NOT A WORD IN THE MESSAGE
 * The field portal's offline queue used to decide "retry or give up" by
 * looking for words like "fetch" or "network" in the message. In a production
 * build every unrecognised error is replaced with a generic sentence (see the
 * end of `readableDbError`), so a technician on a roof with one bar of signal
 * got a network failure re-worded into something the queue read as permanent:
 * the write was thrown at them instead of queued, and anything already queued
 * was discarded on the next sync. The flag survives the re-wording.
 */
export class ReadableError extends Error {
  readonly retryable: boolean

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'ReadableError'
    this.retryable = options.retryable ?? false
  }
}

/** True when the request failed in transit rather than being refused. */
export function isNetworkFailure(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  // A real answer from Postgres always carries a SQLSTATE.
  if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) return false
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('err_internet_disconnected') ||
    message.includes('err_network')
  )
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

  appointments_needs_a_subject:
    'Choose who this visit is for — a lead, a customer or a project — so the crew knows whose site it is.',
  appointments_completed_needs_signoff:
    'A completed visit needs the name of the customer who accepted the work.',
  contracts_one_live_per_lead:
    'This customer already has a contract in progress. Cancel it first if the terms have changed.',
  contracts_one_live_per_quotation: 'A contract has already been raised from this quotation.',
  leads_lost_needs_reason: 'Please record why this opportunity was lost.',
  stock_reservations_project_id_stock_item_id_key:
    'That item is already reserved against this project.',
  commissions_user_id_project_id_key: 'A commission is already recorded for that project.',
  payment_refunds_reason_check: 'Give a reason of at least ten characters for the refund.',
  tickets_satisfaction_rating_check: 'Choose between one and five stars.',
  reviews_rating_check: 'Choose between one and five stars.',
  time_logs_out_after_in: 'The finishing time has to be after the starting time.',
  quotations_lead_id_version_key:
    'Somebody saved another version of this quotation at the same moment. Please save again.',
  stock_items_sku_key: 'That SKU is already in use by another item.',
}

/** Pull the constraint name out of whichever field Postgres put it in. */
function constraintOf(error: DbError): string | undefined {
  const haystack = `${error.message} ${error.details ?? ''}`
  const match = haystack.match(/constraint "([^"]+)"/)
  return match?.[1]
}

export function readableDbError(error: DbError): Error {
  if (isNetworkFailure(error)) {
    return new ReadableError(
      'No connection to the server. Check your signal or Wi-Fi — nothing was saved.',
      { retryable: true },
    )
  }

  if (error.code && SAFE_TO_SHOW.has(error.code)) {
    return new Error(error.message)
  }

  const constraint = constraintOf(error)
  if (constraint && BY_CONSTRAINT[constraint]) {
    return new Error(BY_CONSTRAINT[constraint])
  }

  /* Our own triggers and functions raise these two codes with a sentence
     written for the reader ("That slot has just been taken", "A recorded
     payment cannot be altered"). Postgres raising them itself always uses its
     own fixed phrasing, which names a constraint and is caught above or below. */
  if (
    (error.code === '23505' && !error.message.startsWith('duplicate key value')) ||
    (error.code === '23514' && !error.message.includes('violates check constraint'))
  ) {
    return new Error(error.message)
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

/**
 * A write that RLS filtered out comes back as success with zero rows, not as
 * an error. Every mutation whose target a policy could hide calls this, so a
 * change that never happened is never reported as saved.
 */
export function assertWritten<T>(rows: T[] | null | undefined, refusal: string): T[] {
  if (!rows || rows.length === 0) throw new Error(refusal)
  return rows
}
