/* What is actually left in the database, read as the administrator. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const { error: signInError } = await client.auth.signInWithPassword({
  email: 'admin@demo.solarbros.ph',
  password: 'SolarBros2026!',
})

if (signInError) {
  console.log(`Could not sign in as the demo administrator: ${signInError.message}`)
  console.log('(That may simply mean the accounts are already gone.)')
  process.exit(0)
}

const TABLES = [
  'profiles',
  'leads',
  'estimates',
  'quotations',
  'quotation_lines',
  'contracts',
  'projects',
  'project_milestones',
  'project_crew',
  'invoices',
  'payments',
  'payment_refunds',
  'appointments',
  'appointment_assignees',
  'tickets',
  'ticket_messages',
  'documents',
  'permits',
  'purchase_orders',
  'purchase_order_lines',
  'stock_movements',
  'stock_reservations',
  'serialised_assets',
  'rma_claims',
  'warranty_requests',
  'notifications',
  'audit_log',
  'payroll_runs',
  'payroll_lines',
  'time_logs',
  'commissions',
  'maintenance_schedules',
  'site_photos',
  // Kept on purpose by the clear script.
  'stock_items',
  'suppliers',
  'packages',
  'portfolio_items',
  'blog_posts',
  'faqs',
  'reviews',
  'settings',
]

const KEPT_ON_PURPOSE = new Set([
  'stock_items',
  'suppliers',
  'packages',
  'portfolio_items',
  'blog_posts',
  'faqs',
  'reviews',
  'settings',
  'profiles',
])

const leftovers = []

for (const table of TABLES) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true })
  if (error) {
    console.log(`  ?      ${table.padEnd(24)} ${error.message.slice(0, 50)}`)
    continue
  }
  const n = count ?? 0
  const kept = KEPT_ON_PURPOSE.has(table)
  const flag = n === 0 ? 'empty ' : kept ? 'kept  ' : 'LEFT  '
  if (n > 0) console.log(`  ${flag} ${table.padEnd(24)} ${n}`)
  if (n > 0 && !kept) leftovers.push([table, n])
}

console.log('\n--- transactional tables that still have rows ---')
if (leftovers.length === 0) {
  console.log('  none — the clear-down worked')
} else {
  for (const [t, n] of leftovers) console.log(`  ${t}: ${n}`)
}

const { data: people } = await client
  .from('profiles')
  .select('email, role, is_active')
  .order('role')

console.log('\n--- accounts ---')
for (const p of people ?? []) {
  console.log(`  ${p.role.padEnd(18)} ${p.is_active ? ' ' : '(inactive) '}${p.email}`)
}
