import AdmZip from 'adm-zip';

export function extractHy3(zipBytes: Buffer): string {
  const zip = new AdmZip(zipBytes);
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.hy3'));
  if (!entry) throw new Error('No .hy3 file found in zip');
  return entry.getData().toString('utf8');
}
