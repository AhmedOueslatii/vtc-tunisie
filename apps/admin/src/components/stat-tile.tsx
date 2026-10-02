import Link from 'next/link';

/** Tuile de chiffre : un libellé court, la valeur en grand, un complément facultatif. Cliquable si `href`. */
export function StatTile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold" dir="auto">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const style = 'block rounded-lg border border-line bg-card p-4';
  return href ? (
    <Link href={href} className={`${style} transition-colors hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={style}>{body}</div>
  );
}
