// Source client adapters.
//
// Each source collector (Stripe, Mongo, Grafana, S3) depends on a narrow,
// injected client *port* rather than an SDK directly, so the aggregation logic
// stays unit-testable. This module provides the production adapters wired into
// the engine at startup (see `buildEngine` in ../server.ts).
//
// Integration status
// -------------------
// The concrete external integrations are implemented here:
//   - Stripe  via the `stripe` SDK;
//   - MongoDB via the `mongodb` native driver;
//   - AWS S3  via `@aws-sdk/client-s3` (`ListObjectsV2`);
//   - Grafana via its HTTP API (Prometheus datasource proxy) using native
//     `fetch` — Grafana ships no server SDK.
//
// Each adapter reads its connection settings from the environment. When a
// required setting is absent, the adapter throws {@link SourceNotConfiguredError}
// from its port methods rather than fabricating data. This is a deliberate,
// safe degraded state: the DataAggregator runs each collector with independent
// error isolation (Req 8.3), so an unconfigured/unhealthy source records its
// error on the cache while every other source keeps working, and the UI shows a
// per-widget error indicator with the last-good data.
//
// Environment variables
// ---------------------
//   Stripe   : STRIPE_API_KEY
//   MongoDB  : MONGODB_URI            (required)
//              MONGODB_DB             (optional; else taken from the URI)
//   S3       : AWS_REGION             (required; credentials via the default
//                                      AWS provider chain — env/IAM)
//              S3_DISPUTE_DOCS_BUCKET (optional; defaults to DISPUTE_DOCS_BUCKET)
//              AWS_ROLE_ARN           (optional; when set, assume this IAM role
//                                      via STS before accessing S3)
//              AWS_ROLE_SESSION_NAME  (optional; STS session name)
//              AWS_ROLE_EXTERNAL_ID   (optional; STS external id for cross-account)
//   Grafana  : GRAFANA_URL                   (required)
//              GRAFANA_SERVICE_ACCOUNT_TOKEN (required; preferred) or the
//                                            legacy GRAFANA_API_KEY (fallback).
//                                            Grafana deprecated API keys in
//                                            favour of service-account tokens;
//                                            both are sent as a Bearer token, so
//                                            either works. Prefer the new name.
//              GRAFANA_DATASOURCE_UID        (required; Prometheus datasource UID)
//              GRAFANA_SERVICES              (required; comma-separated job names)

import Stripe from 'stripe';
import { MongoClient as MongoDriver, type Db } from 'mongodb';
import {
    S3Client as S3Sdk,
    ListObjectsV2Command,
    type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

import type {
    StripeClientPort,
    StripeBalanceTransactionRecord,
    StripeChargeRecord,
    StripeDisputeRecord,
} from '../collectors/stripe-collector.js';
import type {
    MongoClientPort,
    MongoUserRecord,
    MongoPaymentRecord,
} from '../collectors/mongo-collector.js';
import type {
    GrafanaClientPort,
    GrafanaServiceMetrics,
    GrafanaApiSamples,
} from '../collectors/grafana-collector.js';
import type { DisputeStatus } from '@fans-fund-me/shared';
import {
    type S3ClientPort,
    type S3ObjectSummary,
    DISPUTE_DOCS_BUCKET,
} from '../collectors/s3-collector.js';

/**
 * Thrown by a source adapter when the external integration it fronts has not
 * been configured/provisioned. Surfaced through the scheduler as that source's
 * `lastError`, leaving other sources unaffected.
 */
export class SourceNotConfiguredError extends Error {
    constructor(source: string, missing: string) {
        super(`${source} integration is not configured (missing ${missing}).`);
        this.name = 'SourceNotConfiguredError';
    }
}

/** Reads an environment variable, returning undefined when unset/empty. */
function env(name: string): string | undefined {
    const value = process.env[name];
    return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Normalises a value that may be a `Date`, an ISO string, or something else
 * (e.g. a BSON timestamp) into an ISO 8601 string. Used for MongoDB records
 * whose `createdAt` field the collector consumes as an ISO string.
 */
function toIso(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'string') {
        return value;
    }
    return String(value);
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

/**
 * Stripe adapter. Reads `STRIPE_API_KEY` and talks to Stripe via the `stripe`
 * SDK. The SDK client is constructed lazily on first use so merely importing
 * this module does not require configuration.
 */
export class StripeClient implements StripeClientPort {
    private readonly apiKey: string | undefined;
    private client: Stripe | undefined;

    /** Upper bound on auto-paginated result sets, to cap API usage. */
    private static readonly MAX_RECORDS = 10_000;

    constructor() {
        this.apiKey = env('STRIPE_API_KEY');
    }

    /** Lazily constructs (and memoises) the Stripe SDK client. */
    private sdk(): Stripe {
        if (this.apiKey === undefined) {
            throw new SourceNotConfiguredError('Stripe', 'STRIPE_API_KEY');
        }
        if (this.client === undefined) {
            this.client = new Stripe(this.apiKey);
        }
        return this.client;
    }

    async listBalanceTransactions(params: {
        createdGte: number;
    }): Promise<StripeBalanceTransactionRecord[]> {
        const stripe = this.sdk();
        const txns = await stripe.balanceTransactions
            .list({ created: { gte: params.createdGte }, limit: 100 })
            .autoPagingToArray({ limit: StripeClient.MAX_RECORDS });
        return txns.map((txn) => ({
            id: txn.id,
            type: txn.type,
            amount: txn.amount,
            net: txn.net,
            fee: txn.fee,
            created: txn.created,
        }));
    }

    async listCharges(params: { createdGte: number }): Promise<StripeChargeRecord[]> {
        const stripe = this.sdk();
        const charges = await stripe.charges
            .list({ created: { gte: params.createdGte }, limit: 100 })
            .autoPagingToArray({ limit: StripeClient.MAX_RECORDS });
        return charges.map((charge) => this.toChargeRecord(charge));
    }

    async listDisputes(params: { createdGte: number }): Promise<StripeDisputeRecord[]> {
        const stripe = this.sdk();
        const disputes = await stripe.disputes
            .list({ created: { gte: params.createdGte }, limit: 100 })
            .autoPagingToArray({ limit: StripeClient.MAX_RECORDS });
        return disputes.map((dispute) => ({
            id: dispute.id,
            amount: dispute.amount,
            // `charge` is a string id unless expanded; normalise to the id.
            charge: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
            // `payment_intent` may be a string id, an expanded object, or null.
            // Normalise to the "pi_..." id (used to key the S3 evidence folders).
            payment_intent:
                dispute.payment_intent == null
                    ? null
                    : typeof dispute.payment_intent === 'string'
                        ? dispute.payment_intent
                        : dispute.payment_intent.id,
            status: dispute.status as DisputeStatus,
            created: dispute.created,
            evidence_details: {
                due_by: dispute.evidence_details?.due_by ?? null,
            },
        }));
    }

    async listRecentCharges(params: { limit: number }): Promise<StripeChargeRecord[]> {
        const stripe = this.sdk();
        // Stripe returns charges newest-first; a single page of `limit` suffices.
        const charges = await stripe.charges.list({ limit: params.limit });
        return charges.data.map((charge) => this.toChargeRecord(charge));
    }

    /** Maps a Stripe charge to the narrow record shape the collector consumes. */
    private toChargeRecord(charge: Stripe.Charge): StripeChargeRecord {
        return {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            created: charge.created,
            status: charge.status as StripeChargeRecord['status'],
            refunded: charge.refunded,
            amount_refunded: charge.amount_refunded,
        };
    }
}

// ---------------------------------------------------------------------------
// MongoDB
// ---------------------------------------------------------------------------

/**
 * MongoDB adapter. Reads `MONGODB_URI` (and optional `MONGODB_DB`) and talks to
 * the database via the native `mongodb` driver. The connection is established
 * lazily on first use and reused across calls.
 */
export class MongoClient implements MongoClientPort {
    private readonly uri: string | undefined;
    private readonly dbName: string | undefined;
    private connection: Promise<Db> | undefined;

    constructor() {
        this.uri = env('MONGODB_URI');
        this.dbName = env('MONGODB_DB');
    }

    /**
     * Connects once and memoises the resulting {@link Db}. Subsequent calls
     * reuse the same connection. If the initial connection attempt fails the
     * memoised promise is cleared so a later call can retry.
     */
    private db(): Promise<Db> {
        if (this.uri === undefined) {
            throw new SourceNotConfiguredError('MongoDB', 'MONGODB_URI');
        }
        if (this.connection === undefined) {
            const uri = this.uri;
            const dbName = this.dbName;
            this.connection = (async () => {
                const client = new MongoDriver(uri);
                await client.connect();
                // `db(undefined)` uses the database encoded in the URI.
                return dbName !== undefined ? client.db(dbName) : client.db();
            })().catch((error) => {
                // Allow a future call to retry a failed connection.
                this.connection = undefined;
                throw error;
            });
        }
        return this.connection;
    }

    async getUsers(): Promise<MongoUserRecord[]> {
        const db = await this.db();
        const docs = await db
            .collection('users')
            .find({}, { projection: { role: 1, createdAt: 1 } })
            .toArray();
        return docs.map((doc) => ({
            role: typeof doc.role === 'string' ? doc.role : String(doc.role),
            createdAt: toIso(doc.createdAt),
        }));
    }

    async getPayments(since: Date): Promise<MongoPaymentRecord[]> {
        const db = await this.db();
        const docs = await db
            .collection('payments')
            .find(
                { createdAt: { $gte: since } },
                { projection: { creatorId: 1, status: 1, createdAt: 1 } },
            )
            .toArray();
        return docs.map((doc) => ({
            creatorId: String(doc.creatorId),
            status: typeof doc.status === 'string' ? doc.status : String(doc.status),
            createdAt: toIso(doc.createdAt),
        }));
    }
}

// ---------------------------------------------------------------------------
// AWS S3
// ---------------------------------------------------------------------------

/**
 * S3 adapter. Reads `AWS_REGION` and lists objects via `ListObjectsV2`,
 * paginating through all continuation tokens.
 *
 * Credentials: by default the AWS SDK's standard provider chain is used
 * (environment variables, shared config, container/instance roles, etc.). When
 * `AWS_ROLE_ARN` is set, the adapter instead assumes that IAM role via STS
 * (`sts:AssumeRole`) and uses the resulting temporary credentials to reach S3.
 * The base credentials from the default chain are used to perform the
 * AssumeRole call, and `fromTemporaryCredentials` transparently refreshes the
 * session before it expires. Optional `AWS_ROLE_EXTERNAL_ID` supports the
 * cross-account external-id pattern, and `AWS_ROLE_SESSION_NAME` names the
 * session (defaults to `fansfund-ops-dashboard`).
 */
export class S3Client implements S3ClientPort {
    private readonly region: string | undefined;
    private readonly bucket: string;
    private readonly roleArn: string | undefined;
    private readonly roleSessionName: string;
    private readonly roleExternalId: string | undefined;
    private client: S3Sdk | undefined;

    constructor() {
        this.region = env('AWS_REGION');
        this.bucket = env('S3_DISPUTE_DOCS_BUCKET') ?? DISPUTE_DOCS_BUCKET;
        this.roleArn = env('AWS_ROLE_ARN');
        this.roleSessionName = env('AWS_ROLE_SESSION_NAME') ?? 'fansfund-ops-dashboard';
        this.roleExternalId = env('AWS_ROLE_EXTERNAL_ID');
    }

    /** Lazily constructs (and memoises) the AWS S3 SDK client. */
    private sdk(): S3Sdk {
        if (this.region === undefined) {
            throw new SourceNotConfiguredError('S3', 'AWS_REGION');
        }
        if (this.client === undefined) {
            const config: S3ClientConfig = { region: this.region };
            if (this.roleArn !== undefined) {
                // Assume the target role via STS. The default provider chain
                // supplies the base credentials used to call AssumeRole; the
                // returned temporary credentials are auto-refreshed on expiry.
                config.credentials = fromTemporaryCredentials({
                    params: {
                        RoleArn: this.roleArn,
                        RoleSessionName: this.roleSessionName,
                        ...(this.roleExternalId !== undefined
                            ? { ExternalId: this.roleExternalId }
                            : {}),
                    },
                    // Region the STS client itself talks to.
                    clientConfig: { region: this.region },
                });
            }
            this.client = new S3Sdk(config);
        }
        return this.client;
    }

    async listObjects(prefix: string): Promise<S3ObjectSummary[]> {
        const s3 = this.sdk();
        const summaries: S3ObjectSummary[] = [];
        let continuationToken: string | undefined;

        do {
            const response = await s3.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                }),
            );
            for (const object of response.Contents ?? []) {
                if (object.Key === undefined) {
                    continue;
                }
                summaries.push({ key: object.Key, size: object.Size ?? 0 });
            }
            continuationToken = response.IsTruncated
                ? response.NextContinuationToken
                : undefined;
        } while (continuationToken !== undefined);

        return summaries;
    }
}

// ---------------------------------------------------------------------------
// Grafana
// ---------------------------------------------------------------------------

/** One second's worth of a 24h / 7d uptime window, used to size UptimeWindow. */
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;

/**
 * Grafana adapter. Grafana ships no server SDK, so this talks to its HTTP API
 * directly with native `fetch`. Service metrics are read from a Prometheus
 * datasource through Grafana's datasource proxy (the Prometheus instant-query
 * endpoint), which keeps response parsing simple.
 *
 * Authentication uses a Grafana service-account token (`GRAFANA_SERVICE_ACCOUNT_TOKEN`),
 * sent as an HTTP `Authorization: Bearer` header. Grafana deprecated the older
 * API keys in favour of service-account tokens; for backward compatibility the
 * legacy `GRAFANA_API_KEY` is still accepted as a fallback (both are Bearer
 * tokens on the wire, so no code path differs).
 *
 * The set of monitored services and the datasource are deployment-specific and
 * supplied via env (`GRAFANA_SERVICES`, `GRAFANA_DATASOURCE_UID`). The PromQL
 * templates below assume a fairly conventional Prometheus setup:
 *   - `up{job="<svc>"}` for reachability/uptime;
 *   - `http_requests_total{status=~"5.."}` for 5xx error counts;
 *   - `http_request_duration_seconds_{sum,count}` histogram for latency;
 *   - the synthetic `ALERTS` series for firing alerts.
 * Adjust the templates here if the deployment exposes different metric names.
 */
export class GrafanaClient implements GrafanaClientPort {
    private readonly baseUrl: string | undefined;
    private readonly apiKey: string | undefined;
    private readonly datasourceUid: string | undefined;
    private readonly services: string[];

    constructor() {
        this.baseUrl = env('GRAFANA_URL');
        // Prefer the current service-account token; fall back to the deprecated
        // API-key variable so existing deployments keep working. Both are sent
        // verbatim as a Bearer token.
        this.apiKey = env('GRAFANA_SERVICE_ACCOUNT_TOKEN') ?? env('GRAFANA_API_KEY');
        this.datasourceUid = env('GRAFANA_DATASOURCE_UID');
        this.services = (env('GRAFANA_SERVICES') ?? '')
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
    }

    /** Validates configuration and returns the resolved settings. */
    private config(): { baseUrl: string; apiKey: string; uid: string; services: string[] } {
        if (this.baseUrl === undefined || this.apiKey === undefined) {
            throw new SourceNotConfiguredError(
                'Grafana',
                'GRAFANA_URL / GRAFANA_SERVICE_ACCOUNT_TOKEN',
            );
        }
        if (this.datasourceUid === undefined) {
            throw new SourceNotConfiguredError('Grafana', 'GRAFANA_DATASOURCE_UID');
        }
        if (this.services.length === 0) {
            throw new SourceNotConfiguredError('Grafana', 'GRAFANA_SERVICES');
        }
        // Normalise the base URL: trim, drop trailing slashes, and default to
        // https:// when no scheme is given. A scheme-less value (e.g.
        // "hurdl.grafana.net") otherwise makes fetch throw "Failed to parse URL".
        let baseUrl = this.baseUrl.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(baseUrl)) {
            baseUrl = `https://${baseUrl}`;
        }
        return {
            baseUrl,
            apiKey: this.apiKey,
            uid: this.datasourceUid,
            services: this.services,
        };
    }

    /**
     * Runs a Prometheus instant query through the Grafana datasource proxy and
     * returns the first scalar sample value, or 0 when there is no result.
     */
    private async queryScalar(expr: string): Promise<number> {
        const { baseUrl, apiKey, uid } = this.config();
        const url =
            `${baseUrl}/api/datasources/proxy/uid/${uid}/api/v1/query` +
            `?query=${encodeURIComponent(expr)}`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
            throw new Error(
                `Grafana query failed (${response.status} ${response.statusText}) for: ${expr}`,
            );
        }

        const body = (await response.json()) as {
            data?: { result?: Array<{ value?: [number, string] }> };
        };
        const first = body.data?.result?.[0]?.value?.[1];
        if (first === undefined) {
            return 0;
        }
        const parsed = Number.parseFloat(first);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    async getServiceMetrics(): Promise<GrafanaServiceMetrics[]> {
        const { services } = this.config();

        return Promise.all(
            services.map(async (svc): Promise<GrafanaServiceMetrics> => {
                const [reachable, uptime24hFrac, uptime7dFrac, errorCount, alertFiring] =
                    await Promise.all([
                        this.queryScalar(`up{job="${svc}"}`),
                        this.queryScalar(`avg_over_time(up{job="${svc}"}[24h])`),
                        this.queryScalar(`avg_over_time(up{job="${svc}"}[7d])`),
                        this.queryScalar(
                            `sum(increase(http_requests_total{job="${svc}",status=~"5.."}[5m]))`,
                        ),
                        this.queryScalar(
                            `sum(ALERTS{alertname!="",alertstate="firing",job="${svc}"})`,
                        ),
                    ]);

                return {
                    name: svc,
                    reachable: reachable > 0,
                    uptime24h: {
                        totalSeconds: SECONDS_PER_DAY,
                        downtimeSeconds: Math.round((1 - uptime24hFrac) * SECONDS_PER_DAY),
                    },
                    uptime7d: {
                        totalSeconds: SECONDS_PER_WEEK,
                        downtimeSeconds: Math.round((1 - uptime7dFrac) * SECONDS_PER_WEEK),
                    },
                    errorCountLast5m: errorCount,
                    alertFiring: alertFiring > 0,
                };
            }),
        );
    }

    async getApiSamples(): Promise<GrafanaApiSamples> {
        const [errorCount, latencySumRate, latencyCountRate] = await Promise.all([
            this.queryScalar(`sum(increase(http_requests_total{status=~"5.."}[5m]))`),
            this.queryScalar(`sum(rate(http_request_duration_seconds_sum[5m]))`),
            this.queryScalar(`sum(rate(http_request_duration_seconds_count[5m]))`),
        ]);

        // The collector computes average latency as the mean of `latenciesMs`,
        // so we hand it a single pre-averaged value. When there are no requests
        // in the window (count rate 0) we return an empty sample set, which the
        // collector treats as an average of 0.
        const latenciesMs =
            latencyCountRate > 0 ? [(latencySumRate / latencyCountRate) * 1000] : [];

        return {
            windowMinutes: 5,
            errorCount,
            latenciesMs,
        };
    }
}
