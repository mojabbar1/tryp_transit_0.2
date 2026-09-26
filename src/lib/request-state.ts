/**
 * Request lifecycle for client-side API calls, as a pure reducer.
 *
 *   idle ─start─► loading ─success─► success
 *                    │
 *                    └─failure─► retrying (while retries remain) ─► success | retrying | error
 *                    └─failure─► error    (not retryable, or retries exhausted)
 *
 * "In flight" is derived from the status, so every terminal state (success, error, idle)
 * clears the loading UI — including a first-attempt success.
 */

export type RequestStatus = 'idle' | 'loading' | 'retrying' | 'success' | 'error';

export interface RequestState<T> {
  status: RequestStatus;
  data: T | null;
  error: string | null;
  /** Retries used so far by the current request (0 on the first attempt). */
  retryCount: number;
  maxRetries: number;
  /** Identifies the current request; results for any other request are ignored. */
  requestId: number;
}

export type RequestAction<T> =
  | { type: 'start'; requestId: number }
  | { type: 'success'; requestId: number; data: T }
  | { type: 'failure'; requestId: number; error: string; retryable: boolean }
  | { type: 'reset' };

export function createRequestState<T>(maxRetries: number): RequestState<T> {
  return {
    status: 'idle',
    data: null,
    error: null,
    retryCount: 0,
    maxRetries,
    requestId: 0,
  };
}

export function isRequestInFlight(state: Pick<RequestState<unknown>, 'status'>): boolean {
  return state.status === 'loading' || state.status === 'retrying';
}

function acceptsResult<T>(state: RequestState<T>, requestId: number): boolean {
  return state.requestId === requestId && isRequestInFlight(state);
}

export function requestReducer<T>(
  state: RequestState<T>,
  action: RequestAction<T>
): RequestState<T> {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        status: 'loading',
        data: null,
        error: null,
        retryCount: 0,
        requestId: action.requestId,
      };

    case 'success':
      if (!acceptsResult(state, action.requestId)) return state;
      return { ...state, status: 'success', data: action.data, error: null };

    case 'failure':
      if (!acceptsResult(state, action.requestId)) return state;
      if (action.retryable && state.retryCount < state.maxRetries) {
        return { ...state, status: 'retrying', retryCount: state.retryCount + 1, error: null };
      }
      return { ...state, status: 'error', data: null, error: action.error };

    case 'reset':
      return { ...state, status: 'idle', data: null, error: null, retryCount: 0 };

    default:
      return state;
  }
}
