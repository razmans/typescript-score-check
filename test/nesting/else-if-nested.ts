function check(a: number, b: number): number {
  if (a > 1) {
    return 1;
  } else if (a > 0) {
    if (b > 0) {
      return 2;
    }
  }
  return 0;
}
