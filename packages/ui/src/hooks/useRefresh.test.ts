import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    buildRefreshUrl,
    shouldStartRefresh,
    isRefreshResponse,
    postRefresh,
    type RefreshScope,
} from './useRefresh';

describe('buildRefreshUrl', () => {
    it('targets /api/refresh for the "all" scope', () => {
        expect(buildRefreshUrl('all')).toBe('/api/refresh');
    });
    it('targets /api/refresh/{widget} for a single widget', () => {
        expect(buildRefreshUrl('revenue')).toBe('/api/refresh/revenue');
        expect(buildRefreshUrl('disputes')).toBe('/api/refresh/disputes');
    });
});

describe('shouldStartRefresh (Req 8.4 duplicate prevention)', () => {
    it('allows a scope that is not in flight', () => {
        expect(shouldStartRefresh(new Set<RefreshScope>(), 'all')).toBe(true);
        expect(
            shouldStartRefresh(new Set<RefreshScope>(['revenue']), 'all'),
        ).toBe(true);
    });
    it('blocks a scope that is already in flight', () => {
        expect(
            shouldStartRefresh(new Set<RefreshScope>(['all']), 'all'),
        ).toBe(false);
        expect(
            shouldStartRefresh(
                new Set<RefreshScope>(['revenue']),
                'revenue',
            ),
        ).toBe(false);
    });
    it('isolates scopes: one widget in flight does not block another', () => {
        const inFlight = new Set<RefreshScope>(['revenue']);
        expect(shouldStartRefresh(inFlight, 'users')).toBe(true);
    });
});

describe('isRefreshResponse', () => {
    it('accepts a well-formed response', () => {
        expect(
            isRefreshResponse({
                triggered: true,
                alreadyInProgress: false,
                scope: 'all',
            }),
        ).toBe(true);
    });
    it('rejects malformed responses', () => {
        expect(isRefreshResponse(null)).toBe(false);
        expect(isRefreshResponse({ triggered: true })).toBe(false);
        expect(
            isRefreshResponse({
                triggered: 'yes',
                alreadyInProgress: false,
                scope: 'all',
            }),
        ).toBe(false);
    });
});

describe('postRefresh (global fetch)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('POSTs and returns triggered on a valid response', async () => {
        const body = { triggered: true, alreadyInProgress: false, scope: 'all' };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => body,
        });
        vi.stubGlobal('fetch', fetchMock);

        const outcome = await postRefresh('all');
        expect(outcome).toEqual({ kind: 'triggered', response: body });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/refresh',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('reports alreadyInProgress from the server verbatim', async () => {
        const body = {
            triggered: false,
            alreadyInProgress: true,
            scope: 'revenue',
        };
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 202,
                json: async () => body,
            }),
        );
        const outcome = await postRefresh('revenue');
        expect(outcome).toEqual({ kind: 'triggered', response: body });
    });

    it('returns error on a non-2xx status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({}),
            }),
        );
        const outcome = await postRefresh('revenue');
        expect(outcome).toEqual({
            kind: 'error',
            message: 'Refresh failed with status 400',
        });
    });

    it('returns error on a malformed body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 202,
                json: async () => ({ nope: true }),
            }),
        );
        const outcome = await postRefresh('all');
        expect(outcome).toEqual({
            kind: 'error',
            message: 'Malformed refresh response',
        });
    });

    it('returns error on a network failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('offline')),
        );
        const outcome = await postRefresh('all');
        expect(outcome).toEqual({ kind: 'error', message: 'offline' });
    });
});
