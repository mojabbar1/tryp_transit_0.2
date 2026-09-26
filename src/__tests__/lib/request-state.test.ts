/**
 * Unit tests for the request lifecycle reducer (F-24)
 */

import {
  RequestAction,
  RequestState,
  createRequestState,
  isRequestInFlight,
  requestReducer,
} from '@/lib/request-state';

type Payload = { value: number };

const run = (
  actions: RequestAction<Payload>[],
  initial: RequestState<Payload> = createRequestState<Payload>(2)
): RequestState<Payload> => actions.reduce(requestReducer<Payload>, initial);

describe('requestReducer', () => {
  it('starts idle and not in flight', () => {
    const state = createRequestState<Payload>(2);

    expect(state.status).toBe('idle');
    expect(isRequestInFlight(state)).toBe(false);
  });

  it('moves to loading on start and clears previous results', () => {
    const previous: RequestState<Payload> = {
      ...createRequestState<Payload>(2),
      status: 'error',
      error: 'old error',
      data: { value: 1 },
      retryCount: 2,
    };

    const state = requestReducer(previous, { type: 'start', requestId: 1 });

    expect(state).toMatchObject({ status: 'loading', data: null, error: null, retryCount: 0, requestId: 1 });
    expect(isRequestInFlight(state)).toBe(true);
  });

  it('clears loading on a first-attempt success', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'success', requestId: 1, data: { value: 42 } },
    ]);

    expect(state.status).toBe('success');
    expect(state.data).toEqual({ value: 42 });
    expect(state.retryCount).toBe(0);
    expect(isRequestInFlight(state)).toBe(false);
  });

  it('retries a retryable failure and clears loading when the retry succeeds', () => {
    const retrying = run([
      { type: 'start', requestId: 1 },
      { type: 'failure', requestId: 1, error: 'HTTP 500', retryable: true },
    ]);

    expect(retrying.status).toBe('retrying');
    expect(retrying.retryCount).toBe(1);
    expect(isRequestInFlight(retrying)).toBe(true);

    const done = requestReducer(retrying, { type: 'success', requestId: 1, data: { value: 7 } });

    expect(done.status).toBe('success');
    expect(done.data).toEqual({ value: 7 });
    expect(isRequestInFlight(done)).toBe(false);
  });

  it('ends in error once retries are exhausted', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'failure', requestId: 1, error: 'first', retryable: true },
      { type: 'failure', requestId: 1, error: 'second', retryable: true },
      { type: 'failure', requestId: 1, error: 'third', retryable: true },
    ]);

    expect(state.status).toBe('error');
    expect(state.error).toBe('third');
    expect(state.retryCount).toBe(2);
    expect(isRequestInFlight(state)).toBe(false);
  });

  it('does not retry a non-retryable failure', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'failure', requestId: 1, error: 'Please fill in all fields', retryable: false },
    ]);

    expect(state.status).toBe('error');
    expect(state.error).toBe('Please fill in all fields');
    expect(state.retryCount).toBe(0);
  });

  it('does not retry when maxRetries is 0', () => {
    const state = run(
      [
        { type: 'start', requestId: 1 },
        { type: 'failure', requestId: 1, error: 'HTTP 500', retryable: true },
      ],
      createRequestState<Payload>(0)
    );

    expect(state.status).toBe('error');
  });

  it('ignores results from a superseded request', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'start', requestId: 2 },
      { type: 'success', requestId: 1, data: { value: 1 } },
      { type: 'failure', requestId: 1, error: 'stale', retryable: false },
    ]);

    expect(state.status).toBe('loading');
    expect(state.requestId).toBe(2);
    expect(state.data).toBeNull();
    expect(state.error).toBeNull();
  });

  it('ignores results that arrive after a reset', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'reset' },
      { type: 'success', requestId: 1, data: { value: 1 } },
    ]);

    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  it('ignores a second result once the request has settled', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'success', requestId: 1, data: { value: 1 } },
      { type: 'failure', requestId: 1, error: 'late', retryable: true },
    ]);

    expect(state.status).toBe('success');
    expect(state.data).toEqual({ value: 1 });
  });

  it('resets to idle and clears the error and retry count', () => {
    const state = run([
      { type: 'start', requestId: 1 },
      { type: 'failure', requestId: 1, error: 'boom', retryable: false },
      { type: 'reset' },
    ]);

    expect(state).toMatchObject({ status: 'idle', data: null, error: null, retryCount: 0 });
    expect(isRequestInFlight(state)).toBe(false);
  });
});
