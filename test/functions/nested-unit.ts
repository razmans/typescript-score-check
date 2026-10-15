function outer(): number {
  const inner = (n: number): number => {
    if (n > 0) {
      if (n > 1) {
        return 1;
      }
    }
    return 0;
  };
  return inner(1);
}
