import { describe, expect, it } from 'vitest';
import { BOM, csvCell, money, toCsv, tunisDateTime } from './csv.js';

describe('csvCell', () => {
  it('écrit les montants en dinars avec virgule et trois décimales', () => {
    expect(csvCell(money(12_300))).toBe('12,300');
    expect(csvCell(money(5))).toBe('0,005');
    expect(csvCell(money(0))).toBe('0,000');
    expect(csvCell(money(-4_280))).toBe('-4,280'); // un montant négatif n'est pas une « formule »
    expect(csvCell(money(1_250_000))).toBe('1250,000');
    expect(csvCell(money(null))).toBe('');
  });

  it('écrit les nombres et booléens', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(12.5)).toBe('12,5');
    expect(csvCell(true)).toBe('oui');
    expect(csvCell(false)).toBe('non');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('protège les séparateurs, guillemets et retours à la ligne', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('il a dit "oui"')).toBe('"il a dit ""oui"""');
    expect(csvCell('ligne1\nligne2')).toBe('"ligne1\nligne2"');
    expect(csvCell('simple, avec virgule')).toBe('simple, avec virgule'); // la virgule n'est pas le séparateur
  });

  it.each(['=1+1', '+33612345678', '-2+3', '@SUM(A1)', '\t=cmd', '\r=cmd', '=HYPERLINK("http://x";"clic")'])(
    'neutralise l\'injection de formule : %j',
    (input) => {
      const cell = csvCell(input);
      const text = cell.startsWith('"') ? cell.slice(1, -1) : cell;
      expect(text.startsWith("'")).toBe(true);
      expect(text.slice(1).startsWith(input.slice(0, 1))).toBe(true); // le contenu d'origine est conservé après l'apostrophe
    },
  );

  it("ne touche pas au texte ordinaire ni à un tiret au milieu", () => {
    expect(csvCell('Avenue Habib Bourguiba')).toBe('Avenue Habib Bourguiba');
    expect(csvCell('Tunis-Carthage')).toBe('Tunis-Carthage');
    expect(csvCell('2026-10-02')).toBe('2026-10-02');
  });
});

describe('tunisDateTime', () => {
  it("convertit à l'heure de Tunis (UTC+1)", () => {
    expect(tunisDateTime(new Date('2026-10-02T13:35:00Z'))).toBe('2026-10-02 14:35');
    expect(tunisDateTime(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01 00:30');
  });
});

describe('toCsv', () => {
  it('produit un fichier lisible par Excel : BOM, point-virgule, CRLF', () => {
    const csv = toCsv(['Nom', 'Montant (DT)'], [['Sami', money(1_500)], ['A;B', money(-200)]]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}Nom;Montant (DT)\r\nSami;1,500\r\n"A;B";-0,200\r\n`);
  });

  it('écrit une ligne d\'en-tête même sans données', () => {
    expect(toCsv(['A', 'B'], [])).toBe(`${BOM}A;B\r\n`);
  });
});
