class Service {
  public run(x: number) {
    if (x > 1) {
      if (x > 2) {
        if (x > 3) {
          return 1;
        }
      }
    }
    return 0;
  }
}

const helper = (a: number) => a + 1;
