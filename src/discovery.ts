export interface DetectedPath {
  path: string
  sources: string[]
}

export class Discovery {
  private store = new Map<string, Set<string>>()

  observe(path: string, sourceRef: string): void {
    let set = this.store.get(path)
    if (!set) {
      set = new Set()
      this.store.set(path, set)
    }
    set.add(sourceRef)
  }

  detected(): DetectedPath[] {
    const out: DetectedPath[] = []
    for (const [path, set] of this.store) {
      if (set.size >= 2) out.push({ path, sources: [...set] })
    }
    return out
  }

  reset(): void {
    this.store.clear()
  }
}
