'use client';
import * as S from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

export function Slider({ className, ...p }: S.SliderProps) {
  return (
    <S.Root className={cn('relative flex h-8 w-full touch-none select-none items-center', className)} {...p}>
      <S.Track className="relative h-2 grow rounded-full bg-slate-200 dark:bg-slate-700">
        <S.Range className="absolute h-full rounded-full bg-brand-500" />
      </S.Track>
      <S.Thumb className="block h-7 w-7 rounded-full border-2 border-brand-600 bg-white dark:bg-slate-900 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
    </S.Root>
  );
}
