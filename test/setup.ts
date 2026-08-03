import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  const jsdomInstance = Reflect.get(globalThis, 'jsdom');
  const jsdomWindow = jsdomInstance && Reflect.get(jsdomInstance, 'window');
  const browserStorage = jsdomWindow && Reflect.get(jsdomWindow, 'localStorage');

  if (browserStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: browserStorage,
    });
  }

  if (typeof Reflect.get(window, 'CSSScopeRule') !== 'function') {
    Object.defineProperty(window, 'CSSScopeRule', {
      configurable: true,
      value: class CSSScopeRule {},
    });
  }
}
