/**
 * Minimal Prometheus-style metrics registry. No external dependency: counters
 * live in memory and are serialized to the text exposition format. Exposed at
 * /metrics when METRICS_ENABLED=true.
 */

export interface MetricCounter {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
}

const counters = new Map<string, MetricCounter>();

function keyOf(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

/** Increments a counter, creating it if needed. Labels must be stable per metric. */
export function inc(name: string, labels: Record<string, string> = {}): void {
  const key = keyOf(name, labels);
  const existing = counters.get(key);
  if (existing) {
    existing.value += 1;
    return;
  }
  counters.set(key, { name, help: helpFor(name), labels, value: 1 });
}

export function resetMetrics(): void {
  counters.clear();
}

function helpFor(name: string): string {
  const known: Record<string, string> = {
    sinc_http_requests_total: 'Total HTTP requests',
    sinc_http_errors_total: 'Total unhandled HTTP errors',
    sinc_analytics_dropped_total: 'Analytics events skipped (not opted in or invalid)',
  };
  return known[name] ?? 'Sinc internal counter';
}

/** Serializes all counters in Prometheus text exposition format. */
export function renderMetrics(): string {
  const byName = new Map<string, MetricCounter[]>();
  for (const c of counters.values()) {
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }
  const lines: string[] = [];
  for (const [name, series] of byName) {
    lines.push(`# HELP ${name} ${helpFor(name)}`);
    lines.push(`# TYPE ${name} counter`);
    for (const c of series) {
      lines.push(`${keyOf(c.name, c.labels)} ${c.value}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
