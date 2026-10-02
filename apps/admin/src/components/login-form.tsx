'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { interpolate } from '@/lib/intl';
import { button, inputClass } from './ui';

type Step = 'phone' | 'code';

/** Connexion par code SMS en deux étapes. Les textes viennent du serveur (langue choisie) via `labels`. */
export function LoginForm({ labels }: { labels: Record<string, string> }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function post(path: string, payload: object): Promise<string | null> {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return null;
      return ((await res.json().catch(() => ({}))) as { code?: string }).code ?? 'UNKNOWN';
    } catch {
      return 'NETWORK';
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const failure =
      step === 'phone' ? await post('/api/auth/otp/request', { phone }) : await post('/api/auth/otp/verify', { phone, code });
    setBusy(false);

    if (failure) {
      setError(labels[`errors.${failure}`] ?? labels['errors.UNKNOWN']);
    } else if (step === 'phone') {
      setStep('code');
    } else {
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {step === 'phone' ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{labels['auth.phone']}</span>
          <input
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            autoFocus
            value={phone}
            placeholder={labels['auth.phonePlaceholder']}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      ) : (
        <>
          <p className="text-sm text-muted">{interpolate(labels['auth.codeSent'] ?? '', { phone })}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{labels['auth.code']}</span>
            <input
              className={`${inputClass} tracking-widest`}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              required
              autoFocus
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={button.primary}>
          {busy ? labels['auth.loading'] : step === 'phone' ? labels['auth.sendCode'] : labels['auth.verify']}
        </button>
        {step === 'code' && (
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => {
              setStep('phone');
              setCode('');
              setError(undefined);
            }}
          >
            {labels['auth.changeNumber']}
          </button>
        )}
      </div>
    </form>
  );
}
