export type BarcodeSymbology = 'auto' | 'code128' | 'ean13';

export interface EncodedBarcode {
  format: 'CODE_128' | 'EAN_13';
  displayValue: string;
  /** Binary bar-module pattern where '1' = black bar and '0' = white space */
  modules: string;
  warning?: string;
}

// Standard ISO/IEC 15417 Code 128 patterns (index 0..106)
// Index 104 = Start B, Index 106 = Stop (13 modules)
const CODE128_PATTERNS: string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '1100011101011',
];

// EAN-13 encoding tables
const EAN_PARITY: string[] = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const EAN_L_CODES: string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

const EAN_G_CODES: string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

const EAN_R_CODES: string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

export function computeEan13CheckDigit(first12Digits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12Digits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function encodeCode128B(rawValue: string): EncodedBarcode {
  const sanitized = Array.from(rawValue.trim())
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join('');

  const payload = sanitized || '000000';
  const startCode = 104; // Start Code B
  let checksum = startCode;
  const patterns: string[] = [CODE128_PATTERNS[startCode]];

  for (let i = 0; i < payload.length; i++) {
    const value = payload.charCodeAt(i) - 32;
    checksum += value * (i + 1);
    patterns.push(CODE128_PATTERNS[value]);
  }

  const checkIndex = checksum % 103;
  patterns.push(CODE128_PATTERNS[checkIndex]);
  patterns.push(CODE128_PATTERNS[106]); // Stop

  return {
    format: 'CODE_128',
    displayValue: payload,
    modules: patterns.join(''),
    warning: sanitized !== rawValue.trim() ? 'Unsupported non-ASCII characters omitted for Code 128.' : undefined,
  };
}

export function encodeEan13(rawValue: string): EncodedBarcode {
  const digits = rawValue.replace(/\D/g, '');
  let normalized13 = '';
  let warning: string | undefined;

  if (digits.length === 12) {
    normalized13 = `${digits}${computeEan13CheckDigit(digits)}`;
  } else if (digits.length === 13) {
    const expectedCheck = computeEan13CheckDigit(digits.slice(0, 12));
    if (Number(digits[12]) !== expectedCheck) {
      normalized13 = `${digits.slice(0, 12)}${expectedCheck}`;
      warning = `Check digit adjusted to ${expectedCheck} for valid EAN-13.`;
    } else {
      normalized13 = digits;
    }
  } else {
    return {
      ...encodeCode128B(rawValue),
      warning: 'EAN-13 requires 12 or 13 digits; encoded as Code 128 instead.',
    };
  }

  const firstDigit = Number(normalized13[0]);
  const parityPattern = EAN_PARITY[firstDigit];
  const parts: string[] = ['101']; // Start guard

  for (let i = 1; i <= 6; i++) {
    const d = Number(normalized13[i]);
    parts.push(parityPattern[i - 1] === 'L' ? EAN_L_CODES[d] : EAN_G_CODES[d]);
  }

  parts.push('01010'); // Center guard

  for (let i = 7; i <= 12; i++) {
    const d = Number(normalized13[i]);
    parts.push(EAN_R_CODES[d]);
  }

  parts.push('101'); // End guard

  return {
    format: 'EAN_13',
    displayValue: normalized13,
    modules: parts.join(''),
    warning,
  };
}

export function encodeBarcodeValue(
  rawValue: string,
  symbology: BarcodeSymbology = 'auto'
): EncodedBarcode {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return encodeCode128B('NO-CODE');
  }

  if (symbology === 'ean13') {
    return encodeEan13(trimmed);
  }

  if (symbology === 'auto' && /^\d{12,13}$/.test(trimmed)) {
    return encodeEan13(trimmed);
  }

  return encodeCode128B(trimmed);
}

/**
 * Converts a binary bar module string ('1'/'0') into contiguous black bar runs
 * [startModuleIndex, moduleSpanWidth] for crisp SVG and vector PDF rendering.
 */
export function getBarcodeBarRuns(modules: string): Array<{ x: number; w: number }> {
  const runs: Array<{ x: number; w: number }> = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      const start = i;
      while (i < modules.length && modules[i] === '1') {
        i += 1;
      }
      runs.push({ x: start, w: i - start });
    } else {
      i += 1;
    }
  }
  return runs;
}
