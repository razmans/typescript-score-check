export class Modifiers {
  static total = 0; // static is not an access modifier
  async load(): Promise<void> {} // async is not an access modifier
  readonly id = 1; // readonly is not an access modifier
  public ok = 1;
  private hidden = 2;
  protected shared = 3;
  #secret = 4; // #private counts
  constructor() {} // exempt
  static {
    Modifiers.total = 1;
  } // exempt
}
