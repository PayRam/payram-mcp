import { describe, expect, it } from 'vitest';
import { parsePositiveDecimalAmount } from '../src/tools/data/getUnsweptBalances.js';

describe('parsePositiveDecimalAmount', () => {
  it('accepts positive decimal amounts', () => {
    expect(parsePositiveDecimalAmount('1')).toBe(1);
    expect(parsePositiveDecimalAmount('0.5')).toBe(0.5);
    expect(parsePositiveDecimalAmount(' 10.250000 ')).toBe(10.25);
  });

  it('rejects malformed and nonpositive amounts', () => {
    expect(parsePositiveDecimalAmount('1abc')).toBeNull();
    expect(parsePositiveDecimalAmount('1.2.3')).toBeNull();
    expect(parsePositiveDecimalAmount('Infinity')).toBeNull();
    expect(parsePositiveDecimalAmount('0')).toBeNull();
    expect(parsePositiveDecimalAmount('-1')).toBeNull();
  });
});
