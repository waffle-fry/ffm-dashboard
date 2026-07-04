// Config API routes.
//
// Exposes the aggregator refresh configuration to the Dashboard UI:
//   GET /api/config  - return the current AggregatorConfig
//   PUT /api/config  - update the refresh interval (clamped to 1-60 minutes)
//
// The refresh interval is validated/clamped by the DataAggregator itself (via
// the shared `clampRefreshInterval` logic, design Property 19): values below 1
// become 1, above 60 become 60, in-range values are rounded, and non-numeric
// inputs default to 5. The clamped value that was actually applied is returned
// so the UI can reconcile its input with what the engine accepted.

import { Router, type Request, type Response } from 'express';
import { DataAggregator } from '../aggregator/scheduler.js';

/**
 * Creates the router mounted at `/api/config`.
 */
export function createConfigRouter(aggregator: DataAggregator): Router {
    const router = Router();

    router.get('/', (_req: Request, res: Response): void => {
        res.status(200).json(aggregator.getConfig());
    });

    router.put('/', (req: Request, res: Response): void => {
        const body = (req.body ?? {}) as { refreshIntervalMinutes?: unknown };
        // The aggregator clamps to [1, 60] and defaults non-numeric input to 5.
        aggregator.setRefreshInterval(body.refreshIntervalMinutes);
        res.status(200).json(aggregator.getConfig());
    });

    return router;
}
