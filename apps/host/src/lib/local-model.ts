import { useSyncExternalStore } from 'react';
import type { RemoteModelSelection } from './types';

declare global { interface Window { __STRATA_LOCAL_MODEL__?: boolean } }
export const localModelEnabled = typeof window !== 'undefined' && window.__STRATA_LOCAL_MODEL__ === true;
export type LocalModelState = {
  available: boolean;
  error?: string | null;
  model: { id: string | null; name: string; variant: string | null; loaded: boolean | null; loading: boolean | null; apiBaseUrl: string };
  context: { choices: number[]; selected: number | null; effective: number | null; phase: string; activeRequests: number | null; error?: string | null };
  autoUnload?: { choices: number[]; selected: number | null; effective: number | null };
  codexSync: { state: string; context?: number; auto_compact_token_limit?: number; max_input_tokens?: number; reload_required?: boolean } | null;
};
let current: LocalModelState | null = null;
let selection: RemoteModelSelection | null = null;
let confirmedContext: number | null = null;
const listeners = new Set<() => void>();
export const localModelSelection = () => localModelEnabled ? selection : null;
export function useLocalModel() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current); }
async function request<T>(action = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/local-model${action ? '/' + action : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-strata-desktop': 'local-model' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message ?? 'The Local Model Could Not Complete This Action.');
  return value as T;
}
export async function refreshLocalModel() {
  current = await request<LocalModelState>();
  if (current.available && current.context.phase === 'ready' && current.context.effective !== confirmedContext) {
    // Update the existing app connection once for each confirmed context tier, never for a pending selection.
    await connectLocalModel();
    confirmedContext = current.context.effective;
  }
  for (const listener of listeners) listener();
  return current;
}
export async function connectLocalModel() {
  const result = await request<{ selection: RemoteModelSelection }>('connection', {});
  selection = result.selection;
  return selection;
}
export async function changeLocalContext(tokens: number) { return request('context', { tokens }); }
export async function changeLocalIdle(seconds: number) { return request('idle', { seconds }); }
export async function controlLocalModel(action: 'load' | 'unload') { return request(action, {}); }
export function startLocalModelUpdates(onConnectionChanged: () => Promise<void>) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const before = confirmedContext;
      await refreshLocalModel();
      if (before !== confirmedContext) await onConnectionChanged();
    }
    catch (error) {
      if (current) { current = {...current, available:false, error:error instanceof Error ? error.message : 'Connection Unavailable'}; for (const listener of listeners) listener(); }
    }
    if (!disposed) timer = setTimeout(tick, document.hidden ? 10000 : 3000);
  };
  void tick();
  return () => { disposed = true; clearTimeout(timer); };
}
