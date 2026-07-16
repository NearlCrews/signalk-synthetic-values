if (typeof window !== 'undefined' && typeof Reflect.get(window, 'CSSScopeRule') !== 'function') {
  Object.defineProperty(window, 'CSSScopeRule', {
    configurable: true,
    value: class CSSScopeRule {},
  });
}
