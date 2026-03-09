// Phase 3: Prometheus-compatible metrics
// Simple counters, gauges, and histograms with text exposition format
export class Counter {
    name;
    help;
    labels;
    value = 0;
    constructor(name, help, labels = {}) {
        this.name = name;
        this.help = help;
        this.labels = labels;
    }
    inc(amount = 1) {
        this.value += amount;
    }
    get() {
        return this.value;
    }
    toPrometheus() {
        const labelStr = this.labelString();
        return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n${this.name}${labelStr} ${this.value}`;
    }
    labelString() {
        const entries = Object.entries(this.labels);
        if (entries.length === 0)
            return "";
        return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
    }
}
export class Gauge {
    name;
    help;
    labels;
    value = 0;
    constructor(name, help, labels = {}) {
        this.name = name;
        this.help = help;
        this.labels = labels;
    }
    set(value) {
        this.value = value;
    }
    inc(amount = 1) {
        this.value += amount;
    }
    dec(amount = 1) {
        this.value -= amount;
    }
    get() {
        return this.value;
    }
    toPrometheus() {
        const labelStr = this.labelString();
        return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${this.name}${labelStr} ${this.value}`;
    }
    labelString() {
        const entries = Object.entries(this.labels);
        if (entries.length === 0)
            return "";
        return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
    }
}
export class Histogram {
    name;
    help;
    buckets;
    labels;
    sum = 0;
    count = 0;
    bucketCounts;
    constructor(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], labels = {}) {
        this.name = name;
        this.help = help;
        this.buckets = buckets;
        this.labels = labels;
        this.bucketCounts = new Array(buckets.length).fill(0);
    }
    observe(value) {
        this.sum += value;
        this.count++;
        for (let i = 0; i < this.buckets.length; i++) {
            if (value <= this.buckets[i]) {
                this.bucketCounts[i]++;
            }
        }
    }
    toPrometheus() {
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
    labelString() {
        const entries = Object.entries(this.labels);
        if (entries.length === 0)
            return "";
        return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
    }
    mergeLabelStr(existing, extra) {
        if (!existing)
            return `{${extra}}`;
        return `{${existing.slice(1, -1)},${extra}}`;
    }
}
export class MetricsRegistry {
    metrics = [];
    counter(name, help, labels) {
        const c = new Counter(name, help, labels);
        this.metrics.push(c);
        return c;
    }
    gauge(name, help, labels) {
        const g = new Gauge(name, help, labels);
        this.metrics.push(g);
        return g;
    }
    histogram(name, help, buckets, labels) {
        const h = new Histogram(name, help, buckets, labels);
        this.metrics.push(h);
        return h;
    }
    toPrometheus() {
        return this.metrics.map((m) => m.toPrometheus()).join("\n\n") + "\n";
    }
}
