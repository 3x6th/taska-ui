/**
 * A decimal string's digits grouped with commas — «1,234,567» — as text,
 * never through `Number`: a count is a decimal string of up to 19 digits
 * (contracts §1). Settings › Plan's usage (TAS-512) and the project's issue
 * counter (TAS-528); here since TAS-528 (art-director N2).
 */
export const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
