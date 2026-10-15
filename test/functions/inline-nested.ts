function total(values: number[]): number {
  return values.reduce((sum, v) => (v > 0 ? sum + v : sum), 0);
}
