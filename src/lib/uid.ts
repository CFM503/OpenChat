let idCounter = 0;

export function uid(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}
