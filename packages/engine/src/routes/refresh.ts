// Refresh API routes.
//
// Lets the Dashboard UI trigger a manual data refresh, either for all widgets
// or for a single widget:
//   POST /api/refresh          - refresh every widget
//   POST /api/refresh/:widget  - refresh a single widget (metric key)
//
// Duplicate-refresh prevention (Req 8.4) is handled by the DataAggregator: a
// refresh requested while one is already in progress shares the in-flight run
// rather than starting a second one. The route reports whether THIS request
// actually started a new refresh (`triggered`) versus joined one already
// running (`alreadyInProgress`).
//
// Refreshes are triggered asynchronously and the route responds 202 Accepted
// immediately, so the UI is not blocked for the (up to 10s per source) refresh
// duration. Collector failures are isolated and recorded on the cache by the
// scheduler, so the fire-and-forget promise never rejects; a defensive catch is
// attached regardless.

import { Router, type Request, type Response } from 'express';
import { DataAggregator } from '../aggregator/scheduler.js';
import { isMetricKey, METRIC_KEYS } from '../cache/metrics-cache.js';

const ACCEPTED = 202;
const BAD_REQUEST = 400;

/**
 * Creates the router mounted at `/api/refresh`.
 */
export function createRefreshRouter(aggregator: DataAggregator): Router {
    const router = Router();

    router.post('/', (_req: Request, res: Response): void => {
        const alreadyInProgress = aggregator.isRefreshInProgress();
        // Fire-and-forget: never rejects (per-collector failures are isolated).
        void aggregator.refresh().catch(() => undefined);
        res.status(ACCEPTED).json({
            triggered: !alreadyInProgress,
            alreadyInProgress,
            scope: 'all',
        });
    });

    router.post('/:widget', (req: Request, res: Response): void => {
        const widget = req.params.widget;
        if (!isMetricKey(widget)) {
            res.status(BAD_REQUEST).json({
                error: 'unknown_widget',
                message: `Unknown widget "${widget}".`,
                validWidgets: METRIC_KEYS,
            });
            return;
        }

        const alreadyInProgress = aggregator.isWidgetRefreshInProgress(widget);
        void aggregator.refreshWidget(widget).catch(() => undefined);
        res.status(ACCEPTED).json({
            triggered: !alreadyInProgress,
            alreadyInProgress,
            scope: widget,
        });
    });

    return router;
}
