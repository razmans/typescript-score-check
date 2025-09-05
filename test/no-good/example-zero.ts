class ExampleZero {
  prop: any;

  constructor() {}

  method(x) {
    let y = x;
    if (x && x.prop) return x.prop;
  }
}
