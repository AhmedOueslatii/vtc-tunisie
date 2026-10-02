'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  // « / » (tableau de bord) ne doit pas rester actif sur toutes les autres pages
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-bg hover:text-fg'}`}
    >
      {children}
    </Link>
  );
}
