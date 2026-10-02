'use client';

/** Erreur imprévue : le texte est volontairement bilingue, ce composant ne connaît pas la langue choisie. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-line bg-card p-6 text-center">
      <p className="font-medium">Une erreur est survenue. / حدث خطأ.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-bg"
      >
        Réessayer / إعادة المحاولة
      </button>
    </div>
  );
}
