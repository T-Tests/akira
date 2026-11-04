'use client';
import { Ghost, HeartOff, CloudRain, MessageSquareWarning, Rainbow, Swords, type LucideIcon } from 'lucide-react';
import { Sheet } from './ui/sheet';
import { Slider } from './ui/slider';
import { Button } from './ui/button';
import { CATEGORIES, COUNTRIES, PROVIDERS, VALUES, allowAll } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Filters, Severity } from '@/lib/types';

const ICONS: Record<string, LucideIcon> = { Swords, Ghost, MessageSquareWarning, HeartOff, CloudRain, Rainbow };

const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-pressed={on}
    className={cn(
      'min-h-10 rounded-full border px-4 text-sm font-medium transition',
      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200',
    )}
  >
    {children}
  </button>
);

const toggle = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((a) => a !== x) : [...arr, x]);

export function FilterDrawer({ open, onOpenChange, filters, setFilters, count }: {
  open: boolean; onOpenChange: (o: boolean) => void; filters: Filters; setFilters: (f: Filters) => void; count: number;
}) {
  const set = (p: Partial<Filters>) => setFilters({ ...filters, preset: null, ...p });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Your boundaries & values"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => set({ limits: allowAll, values: [], maxAge: null })}>Reset</Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>Show {count} {count === 1 ? 'movie' : 'movies'}</Button>
        </div>
      }
    >
      <section className="space-y-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Max content level</h3>
        {CATEGORIES.map((c) => {
          const Icon = ICONS[c.icon];
          const v = filters.limits[c.key];
          return (
            <div key={c.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4 text-slate-500" />{c.label}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', v === 3 ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' : 'bg-brand-100 dark:bg-brand-700/30 text-brand-700 dark:text-brand-100')}>
                  {v === 3 ? 'Any' : `Up to ${c.levels[v]}`}
                </span>
              </div>
              <Slider
                min={0} max={3} step={1} value={[v]} aria-label={`${c.label} maximum`}
                onValueChange={([n]) => set({ limits: { ...filters.limits, [c.key]: n as Severity } })}
              />
              <div className="flex justify-between text-[10px] text-slate-400">{c.levels.map((l) => <span key={l}>{l}</span>)}</div>
            </div>
          );
        })}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Values to nurture</h3>
          <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-semibold">
            {(['any', 'all'] as const).map((m) => (
              <button key={m} onClick={() => set({ valuesMode: m })}
                className={cn('rounded-full px-3 py-1', filters.valuesMode === m && 'bg-white dark:bg-slate-900 shadow')}>
                {m === 'any' ? 'Any' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {VALUES.map((v) => (
            <Chip key={v.slug} on={filters.values.includes(v.slug)} onClick={() => set({ values: toggle(filters.values, v.slug) })}>{v.label}</Chip>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Where I watch</h3>
        <select
          value={filters.country} onChange={(e) => set({ country: e.target.value })}
          className="mb-3 min-h-11 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-sm" aria-label="Country"
        >
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <Chip key={p.id} on={filters.providers.includes(p.id)} onClick={() => set({ providers: toggle(filters.providers, p.id) })}>{p.name}</Chip>
          ))}
        </div>
      </section>
    </Sheet>
  );
}
