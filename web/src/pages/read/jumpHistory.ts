export type ReadingSpot = { at: number; off: number };

/** Reading positions visited through explicit navigation, not ordinary scrolling. */
export class JumpHistory {
  private spots: ReadingSpot[] = [];
  private index = -1;

  get canBack() { return this.index > 0; }
  get canForward() { return this.index >= 0 && this.index < this.spots.length - 1; }
  get current() { return this.index >= 0 ? this.spots[this.index] : null; }

  push(from: ReadingSpot, to: ReadingSpot): boolean {
    if (from.at === to.at && Math.abs(from.off - to.off) < 0.005) return false;
    if (this.index < 0) {
      this.spots = [{ ...from }];
      this.index = 0;
    } else {
      this.spots[this.index] = { ...from };
      this.spots.length = this.index + 1;
    }
    this.spots.push({ ...to });
    this.index++;
    if (this.spots.length > 101) {
      this.spots.shift();
      this.index--;
    }
    return true;
  }

  back(from: ReadingSpot): ReadingSpot | null {
    if (!this.canBack) return null;
    this.spots[this.index] = { ...from };
    return { ...this.spots[--this.index] };
  }

  forward(from: ReadingSpot): ReadingSpot | null {
    if (!this.canForward) return null;
    this.spots[this.index] = { ...from };
    return { ...this.spots[++this.index] };
  }
}
