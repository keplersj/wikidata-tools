// Tests never touch the network: any code that reaches for the global fetch fails loudly.
// Code under test takes `fetch` as a parameter, and tests pass a recorded-fixture fake.
globalThis.fetch = () => {
  throw new Error("Network access is disabled in tests; inject a fake fetch.");
};
