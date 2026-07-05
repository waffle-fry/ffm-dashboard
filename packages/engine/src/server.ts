// Express server for the Dashboard Engine.
//
// `createApp` builds the Express application from an injected cache + aggregator
// so it can be constructed in tests with fakes. `buildEngine` assembles the
// production wiring: the MetricsCache, the four source collectors, and the
// DataAggregator scheduler. `startServer` builds the engine, starts the polling
// scheduler, and binds the HTTP port (8080, matching the ClusterIP service).

import express, { type Express } from 'express';
import cors from 'cors';
import { createMetricsRouter } from './routes/metrics.js';
import { createConfigRouter } from './routes/config.js';
import { createRefreshRouter } from './routes/refresh.js';
import { MetricsCache } from './cache/metrics-cache.js';
import { staleThresholdMs } from './cache/metrics-cache.js';
import { DataAggregator, type MetricCollector } from './aggregator/scheduler.js';
import { StripeCollector } from './collectors/stripe-collector.js';
import { MongoCollector } from './collectors/mongo-collector.js';
import { GrafanaCollector } from './collectors/grafana-collector.js';
import { S3Collector, type OpenDisputeInput } from './collectors/s3-collector.js';
import { SpotlightCollector } from './collectors/spotlight-collector.js';
import {
    StripeClient,
    MongoClient,
    GrafanaClient,
    S3Client,
    SpotlightClient,
    MercuryClient,
    ExchangeRateConverter,
} from './clients/source-clients.js';
import { consoleLogger } from './utils/log.js';

/** Default port the engine listens on (matches the ClusterIP service). */
export const DEFAULT_PORT = 8080;

/** The dependencies the API layer reads from. */
export interface EngineDependencies {
    /** In-memory metrics store the routes serve from. */
    cache: MetricsCache;
    /** Scheduler the config/refresh routes drive. */
    aggregator: DataAggregator;
}

/**
 * Builds the Express application with CORS, JSON body parsing, and the API
 * routes wired to the given cache and aggregator. No external side effects
 * (does not bind a port or start the scheduler), so it is safe to construct in
 * tests.
 */
export function createApp({ cache, aggregator }: EngineDependencies): Express {
    const app = express();

    // Allow the Dashboard UI (served from a different origin in dev) to call the API.
    app.use(cors());
    // Parse JSON request bodies (used by PUT /api/config).
    app.use(express.json());

    // Lightweight liveness probe for K8s.
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });

    // API surface.
    app.use('/api/metrics', createMetricsRouter(cache, () =>
        staleThresholdMs(aggregator.getRefreshIntervalMinutes()),
    ));
    app.use('/api/config', createConfigRouter(aggregator));
    app.use('/api/refresh', createRefreshRouter(aggregator));

    return app;
}

/**
 * Assembles the production engine wiring.
 *
 * Constructs the cache and all four source collectors (each with its
 * environment-configured client adapter), then builds the DataAggregator that
 * schedules them. The S3 collector is fed the current open disputes from the
 * cache (populated by the Stripe collector) so its evidence checks target the
 * live dispute set without coupling the two collectors directly.
 */
export function buildEngine(): EngineDependencies {
    const cache = new MetricsCache();

    // The S3 collector checks evidence for whichever disputes are currently
    // open. Rather than schedule it independently (it cannot assemble a full
    // DisputeMetrics on its own), it is injected into the Stripe collector as an
    // evidence provider: the Stripe collector builds the open dispute list, then
    // asks S3 to enrich each with evidence-upload/batch state. It therefore only
    // ever checks the disputes that are actually open in the current poll.
    const s3Evidence = new S3Collector(new S3Client(), {
        // Unused in evidence-provider mode (the Stripe collector passes the
        // disputes to checkEvidence directly), but required by the type.
        getOpenDisputes: (): OpenDisputeInput[] => [],
    });

    // The Stripe client also serves the platform's own balance; Mercury and the
    // ExchangeRates-backed converter provide the bank balance and FX for the
    // platform-balance tiles on the summary widget (Req 11).
    const stripeClient = new StripeClient();

    const collectors: MetricCollector[] = [
        new StripeCollector(stripeClient, {
            evidenceProvider: s3Evidence,
            balanceProvider: stripeClient,
            mercuryClient: new MercuryClient(),
            converter: new ExchangeRateConverter(),
        }),
        new MongoCollector(new MongoClient()),
        new GrafanaCollector(new GrafanaClient()),
        // Single-creator spotlight panel. The username is configurable via
        // SPOTLIGHT_USERNAME; it defaults to the creator this panel was built for.
        new SpotlightCollector(new SpotlightClient(), {
            username: process.env.SPOTLIGHT_USERNAME || 'yourstraightbf',
        }),
    ];

    const refreshIntervalMinutes = Number(process.env.REFRESH_INTERVAL_MINUTES);
    // Per-source timeout (ms). Configurable because high-volume Stripe accounts
    // can take longer than the 10s default to paginate a month of charges.
    // Non-numeric/unset falls back to the DataAggregator's default (10s).
    const sourceTimeoutMs = Number(process.env.SOURCE_TIMEOUT_MS);
    const aggregator = new DataAggregator(
        cache,
        collectors,
        { refreshIntervalMinutes, sourceTimeoutMs },
        consoleLogger,
    );

    return { cache, aggregator };
}

/**
 * Constructs the engine, starts the polling scheduler, and binds the HTTP port.
 * Returns the underlying HTTP server so callers can close it (e.g. in tests).
 */
export function startServer(port: number = DEFAULT_PORT): ReturnType<Express['listen']> {
    const engine = buildEngine();
    const app = createApp(engine);

    // Begin periodic polling (also triggers one immediate refresh).
    engine.aggregator.start();

    return app.listen(port, () => {
        consoleLogger.info('server_listening', { port });
    });
}
