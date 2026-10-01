export interface SniffedFile {
  ext: 'jpg' | 'png' | 'pdf';
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
}

const MIME_BY_EXT: Record<SniffedFile['ext'], SniffedFile['mime']> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

export const mimeFromExt = (ext: string): SniffedFile['mime'] | undefined => MIME_BY_EXT[ext as SniffedFile['ext']];

/** Type réel d'après les premiers octets : le `Content-Type` envoyé par le client n'est pas fiable. */
export function sniffFileType(data: Buffer): SniffedFile | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: 'jpg', mime: MIME_BY_EXT.jpg };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: MIME_BY_EXT.png };
  }
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: MIME_BY_EXT.pdf };
  return null;
}
