export function sanitizeHttpUrl(
  raw: string | null | undefined,
  options?: { httpsOnly?: boolean }
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (options?.httpsOnly) {
      return protocol === 'https:' ? parsed.toString() : null;
    }
    return protocol === 'https:' || protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function sanitizeOptionalImageUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return sanitizeHttpUrl(trimmed) ?? undefined;
}

const SAFE_RASTER_DATA_URI_RE =
  /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;

export function sanitizeImageSrc(
  raw: string | null | undefined,
  maxLength = 65536
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (trimmed.toLowerCase().startsWith('data:')) {
    return SAFE_RASTER_DATA_URI_RE.test(trimmed) ? trimmed : null;
  }
  return sanitizeHttpUrl(trimmed);
}

