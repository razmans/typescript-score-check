function run(): void {
  try {
    work();
  } catch (error) {
    report();
  }
}
declare function work(): void;
declare function report(): void;
