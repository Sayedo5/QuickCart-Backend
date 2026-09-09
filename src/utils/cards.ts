/** Luhn (mod 10) checksum — validates the PAN before we keep only brand + last4. */
export const luhnCheck = (cardNumber: string): boolean => {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

export const detectCardBrand = (cardNumber: string): { key: 'visa' | 'mastercard' | 'amex' | 'unionpay' | 'unknown'; label: string } => {
  const d = cardNumber.replace(/\D/g, '');
  if (/^4/.test(d)) return { key: 'visa', label: 'Visa' };
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return { key: 'mastercard', label: 'Mastercard' };
  if (/^3[47]/.test(d)) return { key: 'amex', label: 'American Express' };
  if (/^62/.test(d)) return { key: 'unionpay', label: 'UnionPay' };
  return { key: 'unknown', label: 'Card' };
};
