/**
 * Simple in-memory metrics store.
 *
 * Tracks counters and rolling-average latencies for:
 *   - Gmail sync operations
 *   - Semantic search queries
 *   - Embedding batches (indexer)
 *   - Lead scraping requests
 *
 * Exposed via GET /metrics (internal use / monitoring).
 * Resets on process restart — good enough for a single Vercel instance.
 * For multi-instance production, swap this out for a Redis counter or Datadog.
 */

const _startedAt = new Date().toISOString();

const counters = {
    sync: {
        total: 0,
        messages_processed: 0,
        messages_queued: 0,
        auth_errors: 0,
        errors: 0
    },
    search: {
        total: 0,
        errors: 0,
        total_results: 0,
        total_latency_ms: 0   // divide by total for avg
    },
    embedding: {
        jobs_processed: 0,
        texts_embedded: 0,
        errors: 0,
        total_latency_ms: 0
    },
    scrape: {
        total: 0,
        errors: 0,
        cache_hits: 0,
        live_runs: 0
    }
};

/** Increment a counter by key path, e.g. inc('sync', 'total') */
function inc(category, key, by = 1) {
    if (counters[category] && key in counters[category]) {
        counters[category][key] += by;
    }
}

/** Record a latency sample — updates the total so avg can be computed. */
function recordLatency(category, ms) {
    if (counters[category] && 'total_latency_ms' in counters[category]) {
        counters[category].total_latency_ms += ms;
    }
}

/** Return a snapshot suitable for the /metrics endpoint. */
function snapshot() {
    const now = Date.now();
    return {
        started_at: _startedAt,
        uptime_s: Math.floor((now - new Date(_startedAt).getTime()) / 1000),
        sync: { ...counters.sync },
        search: {
            ...counters.search,
            avg_latency_ms: counters.search.total > 0
                ? Math.round(counters.search.total_latency_ms / counters.search.total)
                : 0
        },
        embedding: {
            ...counters.embedding,
            avg_latency_ms: counters.embedding.jobs_processed > 0
                ? Math.round(counters.embedding.total_latency_ms / counters.embedding.jobs_processed)
                : 0
        },
        scrape: { ...counters.scrape }
    };
}

/** Convenience: start a timer, returns a function that returns elapsed ms. */
function startTimer() {
    const t = Date.now();
    return () => Date.now() - t;
}

module.exports = { inc, recordLatency, snapshot, startTimer };
