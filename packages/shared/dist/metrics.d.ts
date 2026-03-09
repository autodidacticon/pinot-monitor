export declare class Counter {
    readonly name: string;
    readonly help: string;
    readonly labels: Record<string, string>;
    private value;
    constructor(name: string, help: string, labels?: Record<string, string>);
    inc(amount?: number): void;
    get(): number;
    toPrometheus(): string;
    private labelString;
}
export declare class Gauge {
    readonly name: string;
    readonly help: string;
    readonly labels: Record<string, string>;
    private value;
    constructor(name: string, help: string, labels?: Record<string, string>);
    set(value: number): void;
    inc(amount?: number): void;
    dec(amount?: number): void;
    get(): number;
    toPrometheus(): string;
    private labelString;
}
export declare class Histogram {
    readonly name: string;
    readonly help: string;
    readonly buckets: number[];
    readonly labels: Record<string, string>;
    private sum;
    private count;
    private bucketCounts;
    constructor(name: string, help: string, buckets?: number[], labels?: Record<string, string>);
    observe(value: number): void;
    toPrometheus(): string;
    private labelString;
    private mergeLabelStr;
}
export declare class MetricsRegistry {
    private metrics;
    counter(name: string, help: string, labels?: Record<string, string>): Counter;
    gauge(name: string, help: string, labels?: Record<string, string>): Gauge;
    histogram(name: string, help: string, buckets?: number[], labels?: Record<string, string>): Histogram;
    toPrometheus(): string;
}
