import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export const driverStatusTone = (status: string): Tone =>
  ({ pending_documents: 'warning', under_review: 'info', approved: 'success', rejected: 'danger' })[status] as Tone | undefined ?? 'neutral';
export const docStatusTone = (status: string): Tone =>
  ({ pending: 'info', approved: 'success', rejected: 'danger', expired: 'warning' })[status] as Tone | undefined ?? 'neutral';
export const tripStatusTone = (status: string): Tone =>
  ({ requested: 'warning', driver_assigned: 'info', driver_arrived: 'info', in_progress: 'info', completed: 'success', cancelled_by_passenger: 'danger', cancelled_by_driver: 'danger', no_driver_found: 'warning' })[status] as Tone | undefined ?? 'neutral';
export const ticketStatusTone = (status: string): Tone =>
  ({ open: 'warning', in_progress: 'info', resolved: 'success' })[status] as Tone | undefined ?? 'neutral';

export const button = {
  primary:
    'inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium hover:bg-bg',
  danger:
    'inline-flex items-center justify-center rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40',
};

export const inputClass =
  'w-full rounded-md border border-line bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent';

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-card p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'success' | 'error'; children: ReactNode }) {
  const style =
    kind === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-md border px-3 py-2 text-sm ${style}`}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}
