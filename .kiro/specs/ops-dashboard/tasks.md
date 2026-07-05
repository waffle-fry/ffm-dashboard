# Implementation Plan: Ops Dashboard

## Overview

This plan implements a full-stack operational dashboard for the FansFund team. The system consists of a React + TypeScript frontend (Dashboard UI) and a Node.js + TypeScript backend (Dashboard Engine). The backend aggregates data from MongoDB, Stripe, Grafana, and AWS S3, caches it in-memory, and serves it via REST API. The frontend renders branded widgets in a configurable grid layout. Both services are containerized for deployment on a local Kubernetes cluster.

## Tasks

- [x] 1. Project scaffolding and shared types
  - [x] 1.1 Initialize monorepo structure with backend and frontend packages
    - Create root `package.json` with workspaces for `packages/engine` and `packages/ui`
    - Set up TypeScript project references (`tsconfig.json` at root, per-package configs)
    - Create `packages/shared/` for shared type definitions
    - Add `vitest` and `fast-check` as dev dependencies
    - _Requirements: 1.1, 2.1_

  - [x] 1.2 Define shared data models and type definitions
    - Create `packages/shared/src/models.ts` with all API response interfaces: `RevenueMetrics`, `PeriodMetrics`, `UserGrowthMetrics`, `GrowthPeriod`, `SystemHealthMetrics`, `ServiceHealth`, `DisputeMetrics`, `DisputeItem`, `DisputeStatus`, `TransactionFeedMetrics`, `TransactionItem`, `PlatformSummaryMetrics`
    - Create `packages/shared/src/config.ts` with `DashboardConfig`, `LayoutItem`, `WidgetInstance`, `WidgetType`, `AggregatorConfig`
    - Create `packages/shared/src/cache.ts` with `CacheEntry<T>`, `MetricsStore`
    - Export all types from `packages/shared/src/index.ts`
    - _Requirements: 2.2, 3.1, 4.1, 5.1, 6.1, 9.1, 10.1_

- [x] 2. Backend core infrastructure
  - [x] 2.1 Set up Express server with API router skeleton
    - Create `packages/engine/src/server.ts` with Express app, CORS config, JSON body parser
    - Create `packages/engine/src/routes/metrics.ts` with route stubs for all endpoints: `/api/metrics/revenue`, `/api/metrics/users`, `/api/metrics/health`, `/api/metrics/disputes`, `/api/metrics/transactions`, `/api/metrics/summary`
    - Create `packages/engine/src/routes/config.ts` with `GET /api/config` and `PUT /api/config`
    - Create `packages/engine/src/routes/refresh.ts` with `POST /api/refresh` and `POST /api/refresh/:widget`
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 8.1, 9.1, 10.1_

  - [x] 2.2 Implement MetricsCache with stale detection
    - Create `packages/engine/src/cache/metrics-cache.ts` implementing `MetricsStore`
    - Implement `get<T>(key)`, `set<T>(key, data)`, `setError(key, error)`, `setRefreshing(key, boolean)` methods
    - Implement `isStale(key, thresholdMs)` method comparing `lastRefreshed` against current time
    - Cache entries retain last-good data on error (never cleared, only overwritten on success)
    - _Requirements: 5.6, 5.7, 6.8, 8.3, 9.5_

  - [x]* 2.3 Write property test for stale data detection (Property 12)
    - **Property 12: Stale data detection**
    - For any cache entry with a `lastUpdated` timestamp and any current time, `isStale` returns true iff the difference exceeds 120 seconds
    - **Validates: Requirements 5.7**

  - [x] 2.4 Implement DataAggregator scheduler
    - Create `packages/engine/src/aggregator/scheduler.ts`
    - Implement configurable polling interval (1–60 min, default 5)
    - Run all source collectors in parallel with independent 10s timeouts
    - On success: update cache with fresh data; on failure: set error in cache, retain last-good data
    - Implement duplicate refresh prevention (ignore requests while refresh in progress)
    - _Requirements: 8.1, 8.3, 8.4_

  - [x]* 2.5 Write property test for refresh interval clamping (Property 19)
    - **Property 19: Refresh interval clamping**
    - For any numeric input, validated interval is clamped to [1, 60]; non-numeric defaults to 5
    - **Validates: Requirements 8.1**

  - [x]* 2.6 Write property test for duplicate refresh prevention (Property 20)
    - **Property 20: Duplicate refresh prevention**
    - For any sequence of refresh requests while one is in progress, exactly one refresh executes
    - **Validates: Requirements 8.4**

- [x] 3. Checkpoint - Backend core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend utility functions
  - [x] 4.1 Implement monetary formatting utility
    - Create `packages/engine/src/utils/formatting.ts`
    - Implement `formatMoney(value: number): string` that outputs exactly 2 decimal places
    - Implement `formatPercentage(value: number): string` that outputs exactly 2 decimal places with `%`
    - _Requirements: 3.1, 6.3, 9.1, 10.1, 10.2, 10.3_

  - [x]* 4.2 Write property test for monetary value formatting (Property 4)
    - **Property 4: Monetary value formatting**
    - For any numeric value (including zero, fractional pennies, large values), output matches `/^\d+\.\d{2}$/`
    - **Validates: Requirements 3.1, 6.3, 9.1, 10.1, 10.3**

  - [x] 4.3 Implement time boundary utilities
    - Create `packages/engine/src/utils/time-boundaries.ts`
    - Implement `getStartOfDay()`, `getStartOfWeek()`, `getStartOfMonth()` using UTC boundaries (week starts Monday)
    - Implement `isWithinPeriod(timestamp: string, periodStart: Date): boolean`
    - _Requirements: 3.1, 3.2, 4.2, 4.3_

  - [x] 4.4 Implement dispute calculation utilities
    - Create `packages/engine/src/utils/disputes.ts`
    - Implement `calculateDaysRemaining(evidenceDueBy: string, now?: Date): number` using UTC calendar days
    - Implement `classifyUrgency(daysRemaining: number): 'overdue' | 'critical' | 'urgent' | 'normal'`
    - Implement `isOpenDispute(status: DisputeStatus): boolean`
    - _Requirements: 6.1, 6.4, 6.5, 6.7, 7.7_

  - [x] 4.5 Write property test for dispute days remaining (Property 13)
    - **Property 13: Dispute days remaining calculation**
    - For any dispute with an evidence_due_by UTC timestamp and any current UTC time, daysRemaining equals calendar days between dates (negative when past)
    - **Validates: Requirements 6.1**

  - [x] 4.6 Write property test for dispute urgency classification (Property 14)
    - **Property 14: Dispute urgency classification**
    - For any integer daysRemaining: overdue when < 0, critical when ≤ 1 and ≥ 0, urgent when ≤ 3 and > 1, normal when > 3
    - **Validates: Requirements 6.4, 6.5, 6.7**

  - [x] 4.7 Write property test for open dispute status filter (Property 18)
    - **Property 18: Open dispute status filter**
    - For any DisputeStatus value, isOpen returns true for 'warning_needs_response', 'warning_under_review', 'needs_response'; false otherwise
    - **Validates: Requirements 7.7**

  - [x] 4.8 Implement average and rate calculation utilities
    - Create `packages/engine/src/utils/calculations.ts`
    - Implement `calculateAverage(gross: number, count: number): string | null` — returns null when count is 0
    - Implement `calculateTakeRate(fees: number, volume: number): string | null` — returns null when volume is 0
    - Implement `calculateDisputeRate(disputes: number, payments: number): string` — returns "0.00%" when payments is 0
    - _Requirements: 3.3, 10.2, 10.3_

  - [x]* 4.9 Write property test for average payment calculation (Property 7)
    - **Property 7: Average payment with division-by-zero safety**
    - For any non-negative gross and count: returns gross/count rounded to 2dp when count > 0, null when count is 0
    - **Validates: Requirements 3.3**

  - [x]* 4.10 Write property test for take rate calculation (Property 24)
    - **Property 24: Take rate calculation**
    - For any non-negative fees and volume: returns (fees/volume × 100) rounded to 2dp when volume > 0, null when volume is 0
    - **Validates: Requirements 10.2**

  - [x]* 4.11 Write property test for dispute rate calculation (Property 25)
    - **Property 25: Dispute rate calculation**
    - For any non-negative disputes and payments: returns (disputes/payments × 100) rounded to 2dp when payments > 0, "0.00%" when payments is 0
    - **Validates: Requirements 10.3**

  - [x] 4.12 Implement transaction formatting utilities
    - Create `packages/engine/src/utils/transactions.ts`
    - Implement `truncatePaymentId(id: string): string` — returns "…" + last 4 chars
    - Implement `stripPii(transaction: RawTransaction): TransactionItem` — only retains truncated ID, amount, currency, timestamp
    - _Requirements: 9.1, 9.4_

  - [x]* 4.13 Write property test for transaction ID truncation (Property 21)
    - **Property 21: Transaction ID truncation**
    - For any string of length ≥ 4, result equals "…" + last 4 chars and contains no other original characters
    - **Validates: Requirements 9.1**

  - [x]* 4.14 Write property test for no PII in transaction output (Property 23)
    - **Property 23: No PII in transaction output**
    - For any payment record with PII fields, the formatted transaction item does not contain any PII field values
    - **Validates: Requirements 9.4**

- [x] 5. Checkpoint - Utility functions and property tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Source collectors
  - [x] 6.1 Implement StripeCollector
    - Create `packages/engine/src/collectors/stripe-collector.ts`
    - Implement `collect()` that retrieves balance transactions, charges, disputes, and recent payments
    - Aggregate revenue (gross/net/fees) per period using UTC time boundaries
    - Count successful/failed/refunded payments per period
    - Calculate average payment per period
    - Retrieve open disputes with evidence_due_by, calculate days remaining, sort by deadline ascending
    - Retrieve 20 most recent successful payments, format with truncated IDs, sort descending by timestamp
    - Calculate monthly gross volume, monthly take rate, open dispute count, monthly dispute rate, monthly payment count
    - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.3, 9.1, 9.2, 10.1, 10.2, 10.3, 10.4_

  - [x]* 6.2 Write property test for revenue aggregation (Property 5)
    - **Property 5: Time-bounded revenue aggregation**
    - For any set of balance transactions with arbitrary amounts and timestamps, gross total for a period equals sum of amounts within that period
    - **Validates: Requirements 3.1, 3.2**

  - [x]* 6.3 Write property test for payment count aggregation (Property 6)
    - **Property 6: Payment count aggregation**
    - For any set of payments with arbitrary statuses and timestamps, count per status per period equals matching payments within period boundaries
    - **Validates: Requirements 3.2, 10.4**

  - [x]* 6.4 Write property test for dispute list ordering (Property 15)
    - **Property 15: Dispute list ordering**
    - For any set of open disputes, the formatted list is sorted ascending by daysRemaining
    - **Validates: Requirements 6.3**

  - [x]* 6.5 Write property test for transaction feed ordering (Property 22)
    - **Property 22: Transaction feed ordering**
    - For any set of transactions, the feed is sorted descending by timestamp and limited to 20 items
    - **Validates: Requirements 9.1, 9.2**

  - [x] 6.6 Implement MongoCollector
    - Create `packages/engine/src/collectors/mongo-collector.ts`
    - Implement `collect()` that queries the `users` collection for total Creators, total Fans
    - Count new Creators and new Fans per period (day/week/month) using UTC boundaries
    - Count active Creators per period (distinct creators with at least one successful payment in period)
    - Return zero for empty periods (never omit metrics)
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x]* 6.7 Write property test for user count aggregation (Property 8)
    - **Property 8: User count aggregation by role and time boundary**
    - For any set of user records with roles and registration timestamps, total per role equals matching count, new per period equals matching within boundaries
    - **Validates: Requirements 4.1, 4.2**

  - [x]* 6.8 Write property test for active creator detection (Property 9)
    - **Property 9: Active creator detection**
    - For any set of creators and payments, active count equals distinct creators with at least one successful payment within period
    - **Validates: Requirements 4.3**

  - [x] 6.9 Implement GrafanaCollector
    - Create `packages/engine/src/collectors/grafana-collector.ts`
    - Implement `collect()` that queries Grafana HTTP API for service health, uptime, error rate, latency, and alert status
    - Classify each service as 'healthy', 'degraded', or 'down' based on metric thresholds
    - Calculate uptime percentage: ((total - downtime) / total × 100) rounded to 2dp
    - Calculate error rate (errors/minute) and average latency (ms) over last 5 minutes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 6.10 Write property test for service health classification (Property 10)
    - **Property 10: Service health status classification**
    - For any set of metric values, classification returns exactly one of ('healthy', 'degraded', 'down') deterministically
    - **Validates: Requirements 5.1**

  - [x]* 6.11 Write property test for uptime and rate calculations (Property 11)
    - **Property 11: Uptime and rate metric calculations**
    - For any uptime measurements: percentage = ((total - downtime) / total × 100) rounded to 2dp; error rate = errors/minutes; avg latency = sum/count
    - **Validates: Requirements 5.2, 5.3**

  - [x] 6.12 Implement S3Collector
    - Create `packages/engine/src/collectors/s3-collector.ts`
    - Implement `collect()` that uses `ListObjectsV2` to check for evidence files at `batches/<number>/<payment-id>/`
    - For each open dispute, determine if evidence is uploaded (at least one file > 0 bytes)
    - Determine evidence submission status from Stripe dispute status
    - Mark both steps complete when status is 'under_review', 'won', or 'lost'
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 6.13 Write property test for evidence upload detection (Property 16)
    - **Property 16: Evidence upload detection**
    - For any S3 listing (empty, zero-byte only, or with files > 0 bytes), upload status is true iff at least one file > 0 bytes
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x]* 6.14 Write property test for dispute progress classification (Property 17)
    - **Property 17: Dispute progress step classification**
    - For any (evidenceUploaded, disputeStatus) pair, progress steps are correctly classified per the rules
    - **Validates: Requirements 7.4, 7.5**

- [x] 7. Checkpoint - All collectors and backend tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Backend API wiring
  - [x] 8.1 Wire collectors into aggregator and connect API routes to cache
    - Update `packages/engine/src/routes/metrics.ts` to read from MetricsCache and return JSON responses with `lastRefreshed` timestamps
    - Wire `GET /api/config` to return current `AggregatorConfig`
    - Wire `PUT /api/config` to validate and update refresh interval (clamp to 1–60)
    - Wire `POST /api/refresh` to trigger full manual refresh (with duplicate prevention)
    - Wire `POST /api/refresh/:widget` to trigger single-widget refresh
    - Initialize all collectors in `server.ts`, pass to DataAggregator, start scheduler
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]* 8.2 Write integration tests for API endpoints
    - Test each metrics endpoint returns correct shape with cache populated
    - Test config endpoints validate interval range
    - Test refresh endpoints trigger collector execution
    - Test error states return cached data with error indicators
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 8.1, 9.1, 10.1_

- [x] 9. Frontend scaffolding and layout
  - [x] 9.1 Initialize React app with Vite, Tailwind CSS, and brand tokens
    - Create `packages/ui/` with Vite + React + TypeScript template
    - Configure Tailwind with dark-mode-first theme, brand colors (dark background, light text, yellow/gold accent)
    - Self-host Work Sans and Outfit fonts as woff2 files with `font-display: swap` and 3s timeout fallback
    - Set up CSS custom properties for brand tokens (contrast ratio ≥ 4.5:1)
    - _Requirements: 1.1, 1.4_

  - [x] 9.2 Implement DashboardShell and WidgetGrid with react-grid-layout
    - Create `packages/ui/src/components/DashboardShell.tsx` as root layout
    - Create `packages/ui/src/components/WidgetGrid.tsx` wrapping `react-grid-layout`
    - Configure responsive breakpoints for viewports 1024px to 5120px
    - Ensure no horizontal scrollbar or content overflow at any supported width
    - Fill full viewport at 1920x1080 without scrolling for default widget config
    - Implement drag-and-drop and resize with layout change callback (< 500ms update)
    - _Requirements: 1.2, 1.3, 2.1, 2.4_

  - [x] 9.3 Implement localStorage config persistence and default layout
    - Create `packages/ui/src/hooks/useWidgetConfig.ts`
    - Serialize `DashboardConfig` to localStorage on every layout change
    - Load from localStorage on mount; fall back to default config with all widgets when empty or corrupt
    - Remove unavailable widget types from loaded config, preserving valid widgets
    - _Requirements: 2.2, 2.3, 2.5_

  - [x]* 9.4 Write property test for config round-trip (Property 1)
    - **Property 1: Dashboard configuration round-trip**
    - For any valid DashboardConfig, serializing to JSON then deserializing produces a deeply equal object
    - **Validates: Requirements 2.2**

  - [x]* 9.5 Write property test for invalid widget type removal (Property 2)
    - **Property 2: Invalid widget type removal preserves valid widgets**
    - For any config with valid and invalid types, loading produces layout with only valid widgets in original positions
    - **Validates: Requirements 2.5**

  - [x]* 9.6 Write property test for grid constraint maintenance (Property 3)
    - **Property 3: Widget operations maintain grid constraints**
    - For any sequence of add/remove/reorder/resize ops, all widgets stay within [1×1, maxColumns×maxRows] and grid boundaries
    - **Validates: Requirements 2.1**

- [x] 10. Checkpoint - Frontend scaffolding
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend widgets — base and data fetching
  - [x] 11.1 Implement base Widget component with common chrome
    - Create `packages/ui/src/components/Widget.tsx`
    - Render title bar, last-refreshed timestamp, loading spinner, error indicator, stale-data indicator (⚠ + "Last updated: X min ago"), manual refresh button
    - Accept children for widget-specific content
    - _Requirements: 5.6, 5.7, 8.2, 8.3, 8.5_

  - [x] 11.2 Implement data fetching hooks with error and stale handling
    - Create `packages/ui/src/hooks/useMetrics.ts` — generic hook that polls `/api/metrics/{widget}` and tracks loading, error, stale state
    - Create `packages/ui/src/hooks/useRefresh.ts` — hook for manual refresh with duplicate prevention
    - Implement per-widget error isolation (one widget error does not affect others)
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

- [x] 12. Frontend widgets — concrete implementations
  - [x] 12.1 Implement RevenueWidget and PaymentCountWidget
    - Create `packages/ui/src/widgets/RevenueWidget.tsx` — displays gross/net/fees for day/week/month in GBP with 2dp
    - Create `packages/ui/src/widgets/PaymentCountWidget.tsx` — displays success/failed/refund counts per period, average payment or "N/A"
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 12.2 Implement UserGrowthWidget
    - Create `packages/ui/src/widgets/UserGrowthWidget.tsx` — displays total Creators/Fans, new registrations per period, active Creators per period
    - Display zero for empty periods
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 12.3 Implement SystemHealthWidget
    - Create `packages/ui/src/widgets/SystemHealthWidget.tsx` — displays service status (healthy/degraded/down), uptime %, error rate, latency
    - Highlight with yellow/gold accent when `alertFiring` is true
    - Show stale-data indicator when data is > 120s old
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

  - [x] 12.4 Implement DisputeCountdownWidget
    - Create `packages/ui/src/widgets/DisputeCountdownWidget.tsx`
    - Display nearest deadline prominently (≥ 32px font)
    - Yellow/gold for ≤ 3 days, red for ≤ 1 day or overdue
    - Display "OVERDUE" in red with days past deadline for negative values
    - Display "No open disputes" when no disputes exist
    - Show dispute list ordered by deadline (soonest first): payment ID, amount GBP 2dp, days remaining
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 12.5 Implement DisputeProgressWidget
    - Create `packages/ui/src/widgets/DisputeProgressWidget.tsx`
    - Display two-step progress per dispute: "Evidence Upload" and "Evidence Submission"
    - Each step shown as "Complete" or "Outstanding"
    - _Requirements: 7.4, 7.5, 7.6_

  - [x] 12.6 Implement TransactionFeedWidget
    - Create `packages/ui/src/widgets/TransactionFeedWidget.tsx`
    - Display scrollable list of up to 20 transactions, most recent first
    - Show truncated ID ("…XXXX"), amount in original currency with 2dp, ISO 8601 timestamp
    - No PII displayed
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 12.7 Implement PlatformSummaryWidget
    - Create `packages/ui/src/widgets/PlatformSummaryWidget.tsx`
    - Display gross volume month-to-date (GBP 2dp), monthly take rate (% or "N/A"), open disputes count, monthly dispute rate (%), monthly payment count
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 13. Frontend ConfigPanel
  - [x] 13.1 Implement ConfigPanel slide-out for widget management
    - Create `packages/ui/src/components/ConfigPanel.tsx`
    - Allow adding/removing widgets and adjusting refresh interval
    - Validate refresh interval to 1–60 range, send PUT to `/api/config`
    - _Requirements: 2.1, 8.1_

- [x] 14. Checkpoint - All frontend components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Containerization and deployment configuration
  - [x] 15.1 Create Dockerfiles for UI and Engine
    - Create `packages/ui/Dockerfile` — multi-stage: build React, serve via Nginx with `/api` proxy to engine service
    - Create `packages/engine/Dockerfile` — build TypeScript, run Node.js server
    - Create `nginx.conf` for UI pod with proxy pass for `/api/*` to `dashboard-engine:8080`
    - _Requirements: 1.1, 8.1_

  - [x] 15.2 Create Kubernetes manifests
    - Create `k8s/namespace.yaml` for `fansfund-ops` namespace
    - Create `k8s/engine-deployment.yaml` with pod spec, ClusterIP service on port 8080
    - Create `k8s/ui-deployment.yaml` with pod spec, NodePort service on 30080
    - Create `k8s/secrets.yaml` template for Stripe key, MongoDB connection string, Grafana API key, AWS credentials
    - _Requirements: 1.1, 8.1_

- [x] 16. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Platform account balances (Requirement 11)
  - [x] 17.1 Extend shared model with balance fields
    - Extend `PlatformSummaryMetrics` in `packages/shared/src/models.ts` with `stripeBalanceUsd`, `stripeBalanceError`, `mercuryBalanceUsd`, `mercuryBalanceError`, `totalBalanceUsd`, `totalBalanceGbp` (all `string | null`)
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.7, 11.8, 11.9_

  - [x] 17.2 Implement CurrencyConverter (ExchangeRates)
    - Add a `CurrencyConverter` port with `convert(amount, from, to): Promise<number | null>` to the engine
    - Implement a Mongo-backed adapter in `packages/engine/src/clients/source-clients.ts` reading the `ExchangeRates` collection in the `Payments` database (confirm the document shape via a temporary read-only inspection script that never prints secrets, then delete it)
    - Same-currency is identity; missing rate returns null
    - _Requirements: 11.3, 11.5, 11.10_

  - [x] 17.3 Add platform Stripe balance read + MercuryClient
    - Extend `StripeClientPort`/`StripeClient` with `getPlatformBalance()` returning available amounts per currency (via `stripe.balance.retrieve()`, no `stripeAccount`)
    - Add a `MercuryClientPort` and `MercuryClient` in `source-clients.ts` calling `GET https://api.mercury.com/api/v1/accounts` with `MERCURY_API_TOKEN`; sum `availableBalance` across accounts (USD)
    - Throw `SourceNotConfiguredError` when the token/permission is absent
    - _Requirements: 11.1, 11.2_

  - [x] 17.4 Fold balances into the summary metric with graceful errors
    - In `packages/engine/src/collectors/stripe-collector.ts`, inject the Mercury port + CurrencyConverter; after building `summary`, read the Stripe platform balance and Mercury balance in independent try/catch blocks
    - Convert the Stripe balance (per-currency) to USD; sum to `totalBalanceUsd` from available USD amounts (null when none); convert the USD total to GBP for `totalBalanceGbp`
    - Populate `stripeBalanceError`/`mercuryBalanceError` on failure without failing the widget
    - Wire the new ports/converter in `buildEngine` (`server.ts`)
    - _Requirements: 11.1–11.10_

  - [x]* 17.5 Property test for currency conversion (Property 26)
    - **Property 26: Currency conversion** — identity for same currency, amount×rate (2dp) when a rate exists, null when no rate
    - **Validates: Requirements 11.3, 11.5, 11.10**

  - [x]* 17.6 Property test for total balance summation (Property 27)
    - **Property 27: Total platform balance summation** — sum of available USD amounts, null when none available
    - **Validates: Requirements 11.4, 11.9**

  - [x] 17.7 Render four balance tiles on PlatformSummaryWidget
    - Extend `buildSummaryStats()` in `packages/ui/src/widgets/PlatformSummaryWidget.tsx` with Stripe Balance (USD), Mercury Balance (USD), Total Balance (USD), and Total Balance (GBP) tiles (USD via `formatCurrency`; GBP via `formatCurrencyAmount(value, 'GBP')`)
    - Surface per-tile error indicators for `stripeBalanceError`/`mercuryBalanceError`; show totals as unavailable when null
    - Update `PlatformSummaryWidget.test.ts` (asserts the exact `buildSummaryStats` output) and `server.integration.test.ts` `summaryPayload()` for the new shape
    - _Requirements: 11.6, 11.7, 11.8, 11.9_

  - [x] 17.8 Deployment config for MERCURY_API_TOKEN
    - Add `MERCURY_API_TOKEN` to `.env.example`, the OPTIONAL_VARS in `scripts/deploy-lib.sh`, and the create-secret flow
    - _Requirements: 11.2_

- [x] 18. Checkpoint - Platform account balances
  - Build, run `npm test`, deploy engine + UI, verify live via `/api/metrics/summary` and a browser check.

- [x] 19. Dispute evidence path fix + Response Upload step (Requirement 7)
  - [x] 19.1 Fix the S3 batch path scheme
    - Batches live at the bucket root as `batch_<number>/<payment-id>/` (not `batches/<number>/...`); update `BATCH_PREFIX`, `buildEvidencePrefix`, and `batchNumberForKey` in `packages/engine/src/collectors/s3-collector.ts`
    - _Requirements: 7.1_
  - [x] 19.2 Rename "Evidence Submission" → "Response Upload" and drive it from S3
    - Rename `DisputeItem.evidenceSubmitted` → `responseUploaded` (shared model + collectors + widget)
    - Add `isResponseUploaded(objects, paymentId)` detecting a >0-byte `<payment-id>.pdf` in the batch folder; feed it into `classifyDisputeProgress`
    - Relabel the second progress step to "Response Upload" in `DisputeProgressWidget`
    - Update Property 17 + tests
    - _Requirements: 7.4, 7.5, 7.6_
  - [x] 19.3 Verify live
    - Build, `npm test`, deploy engine + UI, confirm the previously-outstanding dispute now shows Evidence Upload / Response Upload correctly.

- [x] 20. Grafana Synthetic Monitoring health + interval-based staleness (Requirements 5.1–5.7)
  - [x] 20.1 Point Grafana at the Prometheus datasource and Synthetic Monitoring metrics
    - `GRAFANA_DATASOURCE_UID` must be the Prometheus datasource (e.g. `grafanacloud-prom`), not the Synthetic Monitoring datasource (which 502s on PromQL); `GRAFANA_SERVICES` is the SM check job name(s)
    - Rewrote `GrafanaClient` PromQL to `probe_success` / `probe_all_success_{count,sum}` / `probe_duration_seconds`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 20.2 Derive the staleness threshold from the refresh interval
    - Add `STALE_GRACE_MS` + `staleThresholdMs(refreshIntervalMinutes)`; the metrics route uses `interval + grace` so on-cadence data is never flagged stale (only a missed poll trips it)
    - Update Property 12 wording + tests
    - _Requirements: 5.7_
  - [x] 20.3 Verify live
    - Build, `npm test`, deploy engine, confirm `/api/metrics/health` returns data and the widget no longer shows a false "stale" badge.

- [x] 21. Kiosk deployment and auto-update (Requirement 12)
  - [x] 21.1 Fixed-URL kind cluster
  - [x] 21.2 Boot bootstrap script
  - [x] 21.3 Kiosk display launcher
  - [x] 21.4 Auto-update script
  - [x] 21.5 LaunchAgents + install/uninstall
  - [x] 21.6 KIOSK.md runbook
  - [x] 21.7 Verify what is verifiable in dev
    - Done: `bash -n` + kind YAML validity + plist `plutil -lint` + `auto-update.sh --check` + `make cluster-up` no-op + `npm run build`/`npm test`. On-device boot/auto-login/kiosk flow remains a manual step for the operator (see KIOSK.md).
  - [x] 21.8 On-device diagnostics command
    - `scripts/kiosk/doctor.sh` + `make kiosk-doctor`: read-only checks (tooling, Docker, cluster + loopback port mapping, workloads, URL/API, required env, loaded LaunchAgents, display sleep) with PASS/WARN/FAIL and a non-zero exit on hard failures. Run and confirmed on the dev machine.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_



## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- All monetary values use string representation with exactly 2 decimal places to avoid floating-point display issues
- The shared types package ensures backend and frontend stay in sync
- Backend collectors are designed to fail independently — one source failure doesn't block others
- The fast-check library is used for all property-based tests, integrated with Vitest

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "9.1"] },
    { "id": 2, "tasks": ["2.1", "9.2"] },
    { "id": 3, "tasks": ["2.2", "2.4", "4.1", "4.3", "4.4", "4.8", "4.12", "9.3"] },
    { "id": 4, "tasks": ["2.3", "2.5", "2.6", "4.2", "4.5", "4.6", "4.7", "4.9", "4.10", "4.11", "4.13", "4.14", "9.4", "9.5", "9.6"] },
    { "id": 5, "tasks": ["6.1", "6.6", "6.9", "6.12"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.7", "6.8", "6.10", "6.11", "6.13", "6.14"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2", "11.1", "11.2"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7"] },
    { "id": 10, "tasks": ["13.1"] },
    { "id": 11, "tasks": ["15.1", "15.2"] }
  ]
}
```
