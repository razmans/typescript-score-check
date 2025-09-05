function greet(name: string): string | null {
  const greeting: string = `Hello, ${name}!`;
  return greeting;
}

const result: string = greet("World") ?? "No greeting available";
console.log(result);
