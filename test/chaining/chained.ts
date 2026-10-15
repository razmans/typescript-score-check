declare const a: { b?: { c?: number } } | undefined;
const deep = a && a.b && a.b.c;
