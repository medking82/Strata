import { useEffect, useState } from 'react';
import { useStore, selectRemoteModel, refreshModelConnections, go } from '../lib/store';
import { changeLocalContext, changeLocalIdle, connectLocalModel, controlLocalModel, refreshLocalModel, useLocalModel } from '../lib/local-model';
import './local-model.css';

const contextLabel = (value: number | null | undefined) => value ? `${value / 1024}K` : 'Unconfirmed';
const idleLabel = (value: number | null | undefined) => value ? `${value / 60} Minutes` : 'Unconfirmed';
const count = (value?: number | null) => value == null ? '—' : value.toLocaleString();

export function LocalModelScreen() {
  const data = useLocalModel();
  const hardware = useStore(state => state.hardware);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const context = data?.context;
  const autoUnload = data?.autoUnload;
  const contextPending = !!context && context.selected !== context.effective;
  const idlePending = !!autoUnload && autoUnload.selected !== autoUnload.effective;
  const pending = !!context && (contextPending || idlePending || !['ready', 'idle'].includes(context.phase));
  const transitioning = pending && ['starting', 'draining', 'stopping'].includes(context?.phase ?? '');
  const connected = data?.available === true;
  const loaded = connected && data?.model.loaded === true;
  const sync = data?.codexSync;
  const synced = sync?.state === 'synced' && sync.context === context?.effective;
  const busy = !!action || data?.model.loading === true;
  useEffect(() => { if (!pending && synced) setNotice(null); }, [pending, synced]);
  async function run(name: string, work: () => Promise<unknown>) {
    setAction(name); setError(null); setNotice(null);
    try { await work(); await refreshLocalModel(); }
    catch (error) { setError(error instanceof Error ? error.message : 'The Action Could Not Be Completed.'); }
    finally { setAction(null); }
  }
  async function openChat() {
    const selection = await connectLocalModel();
    await refreshModelConnections();
    selectRemoteModel(selection);
    go('chat');
  }
  return <div className="local-model-page">
    <header className="local-model-header">
      <div><p className="local-eyebrow">Your Private Workspace</p><h1>Local Model</h1><p>One Model. One Connection. Ready For Your Next Conversation.</p></div>
      <span className="local-connection" data-connected={connected}><span aria-hidden="true" />{transitioning ? 'Applying Settings' : connected ? 'Connected Locally' : data ? 'Connection Unavailable' : 'Checking Connection'}</span>
    </header>

    <div className="local-model-grid">
      <section className="local-card local-model-card" aria-labelledby="local-model-title">
        <div className="local-model-identity">
          <div className="local-model-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m16 3 11 6.5v13L16 29 5 22.5v-13L16 3Z" stroke="currentColor" strokeWidth="1.7"/><path d="m5.5 9.8 10.5 6.3 10.5-6.3M16 16v12" stroke="currentColor" strokeWidth="1.7"/><path d="m10.5 6.3 11 6.5" stroke="currentColor" strokeWidth="1.7"/></svg></div>
          <div><div className="local-model-title-row"><h2 id="local-model-title">{data?.model.name ?? 'Qwen 3.8 Flash-Next'}</h2><span className="local-tag">Local</span></div><p>{data?.model.variant ?? 'Huihui V2 Swift · IQ3_XXS'}</p></div>
        </div>
        <div className="local-state-row"><span className="local-state-dot" data-ready={loaded} /><strong>{transitioning ? 'Updating Settings' : action === 'load' || data?.model.loading ? 'Loading Model' : loaded ? 'Ready To Chat' : connected ? 'Available On Demand' : 'Connection Unavailable'}</strong><span>{loaded ? 'The Model Is In Memory.' : 'Your Existing Model Files Stay In Place.'}</span></div>
        <div className="local-facts">
          <div><span>Connection</span><strong>Local API <small>8080</small></strong></div>
          <div><span>Effective Context</span><strong>{contextLabel(context?.effective)}</strong></div>
          <div><span>Codex Sync</span><strong className={synced ? 'local-positive' : ''}>{synced ? 'Synced' : sync?.state === 'pending' ? 'Syncing' : 'Unconfirmed'}</strong></div>
        </div>
        <div className="local-model-actions">
          <button className="local-button local-button-primary" disabled={!connected || pending || !!busy} onClick={() => void run('chat', openChat)}>{action === 'chat' ? 'Opening Chat…' : 'Use In Chat'}<span aria-hidden="true">↗</span></button>
          <button className="local-button local-button-secondary" disabled={!connected || pending || !!busy || (loaded && (context?.activeRequests ?? 0) > 0)} onClick={() => void run(loaded ? 'unload' : 'load', () => controlLocalModel(loaded ? 'unload' : 'load'))}>{action === 'load' ? 'Loading…' : action === 'unload' ? 'Unloading…' : loaded ? 'Unload Model' : 'Preload Model'}</button>
        </div>
      </section>

      <section className="local-card local-context-card" aria-labelledby="local-context-title">
        <div className="local-section-heading"><div><h2 id="local-context-title">Context Length</h2><p>Choose How Much A Conversation Can Remember.</p></div><span className="local-tag">{contextLabel(context?.effective)}</span></div>
        <div className="local-context-options" role="group" aria-label="Context Length">
          {(context?.choices ?? [65536, 131072, 262144]).map(tokens => <button key={tokens} type="button" aria-pressed={context?.selected === tokens} disabled={!connected || !!action || (pending && context?.selected === tokens)} onClick={() => void run('context', async () => { await changeLocalContext(tokens); setNotice('Context Requested. The Change Applies After The Current Response.'); })}><strong>{contextLabel(tokens)}</strong><span>{tokens === 65536 ? 'Everyday' : tokens === 131072 ? 'Extended' : 'Long Context'}</span>{context?.selected === tokens && <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>)}
        </div>
        <div className="local-context-status" role="status" aria-live="polite"><span className="local-state-dot" data-ready={!contextPending && synced} /><div><strong>{contextPending ? `Applying ${contextLabel(context?.selected)}` : synced ? 'Context And Codex Catalog Synced' : 'Checking Context Sync'}</strong><p>{contextPending ? 'Your Current Response Will Finish Before The Model Restarts.' : `${count(context?.effective)} Tokens Available To The Model.`}</p></div></div>
        <p className="local-context-hint">Longer Context Can Use More Memory. Your Saved Choice Is Restored Automatically.</p>
        <div className="local-auto-unload" role="group" aria-labelledby="local-idle-title">
          <div className="local-section-heading"><div><h3 id="local-idle-title">Auto Unload</h3><p>Free Model Memory After A Period Of Inactivity.</p></div><span className="local-tag">{idleLabel(autoUnload?.effective)}</span></div>
          <div className="local-context-options local-idle-options" role="group" aria-label="Auto Unload Time">
            {(autoUnload?.choices ?? [300, 600, 1800]).map(seconds => <button key={seconds} type="button" aria-label={idleLabel(seconds)} aria-pressed={autoUnload?.selected === seconds} disabled={!connected || !autoUnload || !!busy || transitioning || (idlePending && autoUnload.selected === seconds)} onClick={() => void run('idle', async () => { await changeLocalIdle(seconds); setNotice('Auto Unload Preference Saved.'); })}><strong>{seconds / 60}</strong><span>Minutes</span>{autoUnload?.selected === seconds && <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>)}
          </div>
          <p className="local-context-hint" role="status" aria-live="polite">{idlePending ? `Applying ${idleLabel(autoUnload?.selected)} After The Current Response.` : autoUnload?.effective ? 'Saved And Restored At Startup. Your Next Message Loads The Model Automatically.' : 'Checking Auto Unload Settings.'}</p>
        </div>
        <details className="local-details"><summary>Connection Details</summary><dl><div><dt>Model API</dt><dd>{data?.model.apiBaseUrl ?? 'http://127.0.0.1:8080/v1'}</dd></div><div><dt>Model ID</dt><dd>{data?.model.id ?? 'Checking…'}</dd></div><div><dt>Max Input</dt><dd>{count(sync?.max_input_tokens)} Tokens</dd></div><div><dt>Auto Compact</dt><dd>{count(sync?.auto_compact_token_limit)} Tokens</dd></div></dl>{sync?.reload_required && <p>Reopen An Existing Codex Session After Changing Context To Load Its Updated Catalog.</p>}</details>
      </section>

      <aside className="local-card local-machine-card" aria-label="This Computer"><div className="local-section-heading"><div><p className="local-eyebrow">This Computer</p><h2>{hardware?.gpus?.[0]?.name ?? 'Checking Hardware'}</h2></div><span className="local-machine-icon" aria-hidden="true">▦</span></div><div className="local-machine-metrics"><div><strong>{hardware?.gpus?.[0]?.vramGb?.toFixed(1) ?? '—'}<small> GB</small></strong><span>Graphics Memory</span></div><div><strong>{hardware?.memory.totalGb?.toFixed(1) ?? '—'}<small> GB</small></strong><span>System Memory</span></div></div><p>Inference Stays On This PC. The App And Codex Share The Same Local Model.</p></aside>
    </div>
    {(error || (!transitioning && (data?.error || context?.error))) && <div className="local-message local-message-error" role="alert"><strong>Action Needed</strong><span>{error ?? data?.error ?? context?.error}</span><button className="local-button" onClick={() => void run('refresh', refreshLocalModel)}>Refresh</button></div>}
    {notice && !error && <div className="local-message" role="status">{notice}</div>}
  </div>;
}
