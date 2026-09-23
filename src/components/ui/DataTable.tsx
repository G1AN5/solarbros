import type { ReactNode } from 'react'

/* ============================================================================
   DataTable — a thin, generic wrapper over <table>.
   ----------------------------------------------------------------------------
   Deliberately minimal: it handles the shell (scroll container, header styling,
   empty state) but each screen supplies its own cell renderers. That keeps the
   operational tables readable rather than hiding logic behind config objects.

   If sorting/pagination/virtualisation is needed later, swap the internals for
   TanStack Table without changing a single call site.
   ========================================================================== */

export interface Column<T> {
  /** Column heading text. */
  header: string
  /** How to render this column's cell for a given row. */
  cell: (row: T) => ReactNode
  /** Right-aligns and tabular-figures the column — use for money and counts. */
  numeric?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Stable React key for each row. */
  rowKey: (row: T) => string
  /** Called when a row is clicked — makes rows behave like links. */
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = 'Nothing to show yet.',
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty">
          <div className="empty__icon">📭</div>
          <p>{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col, index) => (
              /* Keyed by POSITION, not by header text.
                 Two unlabelled columns — an actions column beside a "Dispatch"
                 button, say — both have `header: ''` and collided, which React
                 reports as "two children with the same key" and resolves by
                 dropping one. Columns are a static ordered list that never
                 reorders, so the index is the correct identity here. */
              <th key={index} className={col.numeric ? 'table__num' : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((col, index) => (
                <td key={index} className={col.numeric ? 'table__num' : undefined}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
