export class Mixed {
  readonly a = 1; // readonly
  b = 2; // never reassigned: should be readonly
  c = 3; // reassigned in a method
  d: number; // assigned only in the constructor: should be readonly
  e = 5; // compound assignment elsewhere
  #f = 6; // destructuring assignment elsewhere
  constructor() {
    this.d = 4;
  }
  update(other: Mixed): void {
    this.c = 10;
    other.e += 1;
    [this.#f] = [7];
  }
}
