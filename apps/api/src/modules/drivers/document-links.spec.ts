import { describe, expect, it } from 'vitest';
import { documentLinkPath, signDocumentLink, verifyDocumentLink } from './document-links.js';

const SECRET = 'a'.repeat(32);
const parts = { docId: '11111111-1111-4111-8111-111111111111', adminId: '22222222-2222-4222-8222-222222222222', exp: 2_000_000_000 };
const NOW = 1_999_999_000;

describe('liens signés vers les documents', () => {
  it('acceptent un lien intact avant son échéance', () => {
    const sig = signDocumentLink(SECRET, parts);
    expect(verifyDocumentLink(SECRET, parts, sig, NOW)).toBe('ok');
  });

  it("refusent un lien expiré, et distinguent « expiré » de « falsifié »", () => {
    const sig = signDocumentLink(SECRET, parts);
    expect(verifyDocumentLink(SECRET, parts, sig, parts.exp)).toBe('expired');
    expect(verifyDocumentLink(SECRET, parts, sig, parts.exp + 3600)).toBe('expired');
    // Prolonger l'échéance sans resigner invalide la signature : on ne peut pas rallonger un lien
    expect(verifyDocumentLink(SECRET, { ...parts, exp: parts.exp + 3600 }, sig, parts.exp + 10)).toBe('invalid');
  });

  it('lient la signature au document, à l\'admin et à l\'échéance', () => {
    const sig = signDocumentLink(SECRET, parts);
    expect(verifyDocumentLink(SECRET, { ...parts, docId: '33333333-3333-4333-8333-333333333333' }, sig, NOW)).toBe('invalid');
    expect(verifyDocumentLink(SECRET, { ...parts, adminId: '44444444-4444-4444-8444-444444444444' }, sig, NOW)).toBe('invalid');
    expect(verifyDocumentLink(SECRET, { ...parts, exp: parts.exp - 1 }, sig, NOW)).toBe('invalid');
  });

  it('refusent une signature vide, tronquée ou signée avec un autre secret', () => {
    const sig = signDocumentLink(SECRET, parts);
    expect(verifyDocumentLink(SECRET, parts, '', NOW)).toBe('invalid');
    expect(verifyDocumentLink(SECRET, parts, sig.slice(0, -2), NOW)).toBe('invalid');
    expect(verifyDocumentLink(SECRET, parts, signDocumentLink('b'.repeat(32), parts), NOW)).toBe('invalid');
  });

  it("ne réutilisent pas la clé de signature d'ailleurs : la signature n'est pas le HMAC brut du secret", () => {
    expect(signDocumentLink(SECRET, parts)).not.toBe(signDocumentLink(SECRET, { ...parts, exp: parts.exp + 1 }));
  });

  it("produisent un chemin relatif à l'API, avec échéance, admin et signature", () => {
    const path = documentLinkPath(SECRET, parts);
    const url = new URL(path, 'http://api.test');
    expect(url.pathname).toBe(`/documents/${parts.docId}/file`);
    expect(url.searchParams.get('e')).toBe(String(parts.exp));
    expect(url.searchParams.get('a')).toBe(parts.adminId);
    expect(verifyDocumentLink(SECRET, parts, url.searchParams.get('s')!, NOW)).toBe('ok');
  });
});
