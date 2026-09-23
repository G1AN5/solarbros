/* ============================================================================
   Tabs — a controlled tab strip.
   Kept "controlled" (parent owns the active value) so a screen can also drive
   the selection from the URL query string later, e.g. ?tab=documents.
   ========================================================================== */

interface TabsProps<T extends string> {
  tabs: { value: T; label: string; count?: number }[]
  active: T
  onChange: (value: T) => void
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === active}
          className={`tabs__tab${tab.value === active ? ' is-active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="dim"> ({tab.count})</span>}
        </button>
      ))}
    </div>
  )
}
