/** Monotonic generation token so a late response cannot overwrite a newer page. */
export class RequestGate {
  #generation = 0;

  next(): number {
    this.#generation += 1;
    return this.#generation;
  }

  current(): number {
    return this.#generation;
  }

  isCurrent(token: number): boolean {
    return token === this.#generation;
  }
}

export function dropIfStale<T>(token: number, current: number, value: T): T | undefined {
  return token === current ? value : undefined;
}
