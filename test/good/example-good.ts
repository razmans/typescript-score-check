function greet(name: string): string {
  const greeting: string = `Hello, ${name}!`;
  return greeting;
}

const result: string = greet("World");
console.log(result);
