/** Son 60 saniyedeki üretim/tüketimi saniyelik kovalarda tutar. */
export class ProductionStats {
  private produced: Array<Record<string, number>> = [{}];
  private consumed: Array<Record<string, number>> = [{}];
  static readonly WINDOW = 60;

  produce(item: string, n = 1) {
    const b = this.produced[this.produced.length - 1];
    b[item] = (b[item] ?? 0) + n;
  }

  consume(item: string, n = 1) {
    const b = this.consumed[this.consumed.length - 1];
    b[item] = (b[item] ?? 0) + n;
  }

  /** Her saniye çağrılır: yeni kova açar, eskileri atar */
  rotate() {
    this.produced.push({});
    this.consumed.push({});
    if (this.produced.length > ProductionStats.WINDOW) this.produced.shift();
    if (this.consumed.length > ProductionStats.WINDOW) this.consumed.shift();
  }

  private perMinute(buckets: Array<Record<string, number>>): Record<string, number> {
    // Son kova henüz dolmadığı için hesaba katılmaz
    const full = buckets.slice(0, -1);
    const out: Record<string, number> = {};
    if (!full.length) return out;
    for (const b of full) for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
    const scale = 60 / full.length;
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] * scale * 10) / 10;
    return out;
  }

  snapshot(): { produced: Record<string, number>; consumed: Record<string, number> } {
    return { produced: this.perMinute(this.produced), consumed: this.perMinute(this.consumed) };
  }
}
