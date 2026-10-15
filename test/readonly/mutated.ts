// count is mutated, so it can't be readonly and is not counted
export class Counter {
  private count = 0;
  inc(): void {
    this.count++;
  }
}
