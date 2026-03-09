// Phase 3: Prometheus-compatible metrics
// Simple counters, gauges, and histograms with text exposition format

export class Counter {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labels: Record<string, string> = {},
  ) {}

  inc(amount = 1): void {
    this.value += amount;
  }

  get(): number {
    return this.value;
  }

  toPrometheus(): string {
    const labelStr = this.labelString();
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n${this.name}${labelStr} ${this.value}`;
  }

  private labelString(): string {
    const entries = Object.entries(this.labels);
    if (entries.length === 0) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }
}

export class Gauge {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labels: Record<string, string> = {},
  ) {}

  set(value: number): void {
    this.value = value;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  dec(amount = 1): void {
    this.value -= amount;
  }

  get(): number {
    return this.value;
  }

  toPrometheus(): string {
    const labelStr = this.labelString();
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${this.name}${labelStr} ${this.value}`;
  }

  private labelString(): string {
    const entries = Object.entries(this.labels);
    if (entries.length === 0) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }
}

export class Histogram {
  private sum = 0;
  private count = 0;
  private bucketCounts: number[];

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    readonly labels: Record<string, string> = {},
  ) {
    this.bucketCounts = new Array(buckets.length).fill(0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this.bucketCounts[i]++;
      }
    }
  }

  toPrometheus(): string {
    const labelStr = this.labelString();
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.bucketCounts[i];
      const le = this.buckets[i];
      lines.push(`${this.name}_bucket${this.mergeLabelStr(labelStr, `le="${le}"`)} ${cumulative}`);
    }
    lines.push(`${this.name}_bucket${this.mergeLabelStr(labelStr, `le="+Inf"`)} ${this.count}`);
    lines.push(`${this.name}_sum${labelStr} ${this.sum}`);
    lines.push(`${this.name}_count${labelStr} ${this.count}`);
    return lines.join("\n");
  }

  private labelString(): string {
    const entries = Object.entries(this.labels);
    if (entries.length === 0) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }

  private mergeLabelStr(existing: string, extra: string): string {
    if (!existing) return `{${extra}}`;
    return `{${existing.slice(1, -1)},${extra}}`;
  }
}

export class MetricsRegistry {
  private metrics: Array<Counter | Gauge | Histogram> = [];

  counter(name: string, help: string, labels?: Record<string, string>): Counter {
    const c = new Counter(name, help, labels);
    this.metrics.push(c);
    return c;
  }

  gauge(name: string, help: string, labels?: Record<string, string>): Gauge {
    const g = new Gauge(name, help, labels);
    this.metrics.push(g);
    return g;
  }

  histogram(name: string, help: string, buckets?: number[], labels?: Record<string, string>): Histogram {
    const h = new Histogram(name, help, buckets, labels);
    this.metrics.push(h);
    return h;
  }

  toPrometheus(): string {
    return this.metrics.map((m) => m.toPrometheus()).join("\n\n") + "\n";
  }
}
