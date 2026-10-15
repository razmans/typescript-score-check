declare const res: Disposable;
function f(): void {
  using handle = res;
}
