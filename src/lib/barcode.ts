import type { Product } from '../types/pos';

export interface ParsedScanInput {
  code: string;
  quantity: number;
}

/**
 * Parses scanner or cashier keyboard input.
 * Supports optional quantity multipliers such as "3*89012345" or "2xSKU-001".
 */
export function parseScanInput(raw: string): ParsedScanInput {
  const cleaned = raw.replace(/[\r\n\t]+/g, '').trim();
  if (!cleaned) {
    return { code: '', quantity: 1 };
  }

  const multiplierMatch = cleaned.match(/^(\d{1,3})\s*[*xX]\s*(.+)$/);
  if (multiplierMatch) {
    const qty = Number.parseInt(multiplierMatch[1], 10);
    const code = multiplierMatch[2].trim();
    if (qty >= 1 && code.length > 0) {
      return { code, quantity: qty };
    }
  }

  return { code: cleaned, quantity: 1 };
}

/**
 * Checks whether a product is assigned to the specified branch (regardless of active/archived status).
 * Legacy products with undefined `availableBranchIds` are treated as available at all branches.
 */
export function isProductAssignedToBranch(product: Product, branchId: string): boolean {
  if (!branchId) return true;
  if (product.availableBranchIds === undefined) return true;
  return product.availableBranchIds.includes(branchId);
}

/**
 * Checks whether a product is active and permitted for sale/stock at the specified branch.
 */
export function isProductAvailableAtBranch(product: Product, branchId: string): boolean {
  if (product.status !== 'active') return false;
  return isProductAssignedToBranch(product, branchId);
}

/**
 * Resolves a scanned barcode or SKU to an active, branch-eligible product.
 * Exact barcode matches take precedence over SKU matches, followed by
 * EAN-13 <-> UPC-A 12/13-digit leading-zero equivalence.
 */
export function findProductByScanCode(
  products: Product[],
  activeBranchId: string,
  rawCode: string
): Product | null {
  const normalized = rawCode.trim().toLowerCase();
  if (!normalized) return null;

  const eligible = products.filter((p) => isProductAvailableAtBranch(p, activeBranchId));

  const barcodeMatch = eligible.find(
    (p) => p.barcode && p.barcode.trim().toLowerCase() === normalized
  );
  if (barcodeMatch) return barcodeMatch;

  const skuMatch = eligible.find((p) => p.sku.trim().toLowerCase() === normalized);
  if (skuMatch) return skuMatch;

  if (/^\d{12,13}$/.test(normalized)) {
    const ean13Equivalent = normalized.length === 12 ? `0${normalized}` : normalized;
    const upc12Equivalent = normalized.length === 13 && normalized.startsWith('0')
      ? normalized.slice(1)
      : normalized;

    const eanUpcMatch = eligible.find((p) => {
      const bc = p.barcode?.trim();
      if (!bc || !/^\d{12,13}$/.test(bc)) return false;
      const bcAs13 = bc.length === 12 ? `0${bc}` : bc;
      return bcAs13 === ean13Equivalent || bc === upc12Equivalent;
    });
    if (eanUpcMatch) return eanUpcMatch;
  }

  return null;
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Emits a crisp POS terminal beep on scan success or a brief low buzz on error.
 */
export function playScannerTone(kind: 'success' | 'error'): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (kind === 'success') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    } else {
      [0, 0.11].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now + offset);
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.14, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.085);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.09);
      });
    }
  } catch {
    // Ignore audio errors when autoplay/audio policy blocks sound
  }
}
