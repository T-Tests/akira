'use client';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/** Bottom sheet: thumb-reachable on phones. */
export function Sheet({ open, onOpenChange, title, children, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] max-w-xl flex-col rounded-t-3xl bg-white dark:bg-slate-900 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b dark:border-slate-700 px-5 py-4">
            <D.Title className="text-lg font-bold">{title}</D.Title>
            <D.Close className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X className="h-5 w-5" /></D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t dark:border-slate-700 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
