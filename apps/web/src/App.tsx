import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';

type Env = 'dev' | 'staging' | 'prod';

type Config = {
  enabled: boolean;
  killSwitch: boolean;
  allowlist: string[];
  denylist: string[];
  attributeRules: Array<{ attribute: string; operator: 'equals' | 'in'; value?: string; values?: string[] }>;
  percentageRollout: number;
  salt: string;
  allowEmails?: string[];
  denyEmails?: string[];
  allowEmailDomains?: string[];
  denyEmailDomains?: string[];
};

const csv = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map((x) => x.trim()).filter(Boolean);

type Flag = {
  key: string;
  name: string;
  description: string;
  environments: Record<Env, { version: number; config: Config }>;
};

type Audit = {
  id: number;
  environment: Env;
  version: number;
  actor: string;
  reason: string;
  createdAt: string;
};

const defaultConfig = (key: string, env: Env): Config => ({
  enabled: false,
  killSwitch: false,
  allowlist: [],
  denylist: [],
  attributeRules: [],
  percentageRollout: 0,
  salt: `${key}-${env}`
});

function App() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [selectedEnv, setSelectedEnv] = useState<Env>('dev');
  const [audit, setAudit] = useState<Audit[]>([]);
  const [createKey, setCreateKey] = useState('new-checkout');
  const [createName, setCreateName] = useState('New Checkout');
  const [createDescription, setCreateDescription] = useState('');
  const [evalUser, setEvalUser] = useState('user_123');
  const [evalEmail, setEvalEmail] = useState('');
  const [saveError, setSaveError] = useState('');
  const [evalCountry, setEvalCountry] = useState('US');
  const [evalResult, setEvalResult] = useState<any>(null);

  const selectedFlag = useMemo(() => flags.find((f) => f.key === selectedKey), [flags, selectedKey]);
  const selectedState = selectedFlag?.environments[selectedEnv];

  const refreshFlags = async () => {
    const response = await fetch('/api/admin/flags');
    const body = await response.json();
    setFlags(body);
    if (!selectedKey && body[0]) setSelectedKey(body[0].key);
  };

  useEffect(() => {
    refreshFlags();
    const stream = new EventSource('/api/admin/stream');
    stream.addEventListener('flag_changed', () => {
      refreshFlags();
      if (selectedKey) fetchAudit(selectedKey);
    });
    return () => stream.close();
  }, []);

  const fetchAudit = async (key: string) => {
    const response = await fetch(`/api/admin/flags/${key}/audit`);
    setAudit(await response.json());
  };

  useEffect(() => {
    if (selectedKey) fetchAudit(selectedKey);
  }, [selectedKey]);

  const createFlag = async (e: FormEvent) => {
    e.preventDefault();
    await fetch('/api/admin/flags', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'developer' },
      body: JSON.stringify({
        key: createKey,
        name: createName,
        description: createDescription,
        actor: 'web-user',
        environments: { dev: { ...defaultConfig(createKey, 'dev'), enabled: true, percentageRollout: 100 } }
      })
    });
    await refreshFlags();
    setSelectedKey(createKey);
  };

  const saveConfig = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedFlag || !selectedState) return;
    const form = new FormData(e.currentTarget);
    const allowlist = String(form.get('allowlist') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const denylist = String(form.get('denylist') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const percentageRollout = Number(form.get('percentageRollout') ?? 0);
    const config: Config = {
      enabled: form.get('enabled') === 'on',
      killSwitch: form.get('killSwitch') === 'on',
      allowlist,
      denylist,
      attributeRules: [{ attribute: 'country', operator: 'in', values: String(form.get('countries') ?? '').split(',').map((x) => x.trim()).filter(Boolean) }],
      percentageRollout,
      salt: String(form.get('salt') ?? `${selectedFlag.key}-${selectedEnv}`),
      allowEmails: csv(form.get('allowEmails')),
      denyEmails: csv(form.get('denyEmails')),
      allowEmailDomains: csv(form.get('allowEmailDomains')),
      denyEmailDomains: csv(form.get('denyEmailDomains'))
    };

    const response = await fetch(`/api/admin/flags/${selectedFlag.key}/environments/${selectedEnv}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-role': selectedEnv === 'prod' ? 'admin' : 'developer' },
      body: JSON.stringify({
        actor: 'web-user',
        reason: 'edited in UI',
        expectedVersion: selectedState.version,
        config
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setSaveError(
        Array.isArray(body.details)
          ? body.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join('; ')
          : String(body.error ?? 'save failed')
      );
    } else {
      setSaveError('');
    }
    await refreshFlags();
    await fetchAudit(selectedFlag.key);
  };

  const runEval = async () => {
    if (!selectedFlag) return;
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        flagKey: selectedFlag.key,
        environment: selectedEnv,
        context: { userId: evalUser || undefined, email: evalEmail || undefined, attributes: { country: evalCountry } }
      })
    });
    setEvalResult(await response.json());
  };

  return (
    <div className="layout">
      <aside>
        <h2>ShipSafe Flags</h2>
        <form onSubmit={createFlag}>
          <h3>Create Flag</h3>
          <input value={createKey} onChange={(e) => setCreateKey(e.target.value)} placeholder="flag-key" />
          <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="display name" />
          <input value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} placeholder="description" />
          <button type="submit">Create</button>
        </form>
        <h3>Flags</h3>
        {flags.map((flag) => (
          <button key={flag.key} className={selectedKey === flag.key ? 'active' : ''} onClick={() => setSelectedKey(flag.key)}>
            {flag.key}
          </button>
        ))}
      </aside>

      <main>
        {!selectedFlag && <p>No flags yet.</p>}
        {selectedFlag && selectedState && (
          <>
            <h2>{selectedFlag.name}</h2>
            <div className="env-row">
              {(['dev', 'staging', 'prod'] as Env[]).map((env) => (
                <button key={env} className={selectedEnv === env ? 'active' : ''} onClick={() => setSelectedEnv(env)}>
                  {env} v{selectedFlag.environments[env].version}
                </button>
              ))}
            </div>

            <form onSubmit={saveConfig} className="card">
              <label><input name="enabled" type="checkbox" defaultChecked={selectedState.config.enabled} /> Enabled</label>
              <label><input name="killSwitch" type="checkbox" defaultChecked={selectedState.config.killSwitch} /> Emergency off</label>
              <label>Allowlist <input name="allowlist" defaultValue={selectedState.config.allowlist.join(',')} /></label>
              <label>Denylist <input name="denylist" defaultValue={selectedState.config.denylist.join(',')} /></label>
              <label>Countries (in) <input name="countries" defaultValue={(selectedState.config.attributeRules[0]?.values ?? []).join(',')} /></label>
              <label>Allow emails <input name="allowEmails" defaultValue={(selectedState.config.allowEmails ?? []).join(',')} /></label>
              <label>Deny emails <input name="denyEmails" defaultValue={(selectedState.config.denyEmails ?? []).join(',')} /></label>
              <label>Allow email domains <input name="allowEmailDomains" defaultValue={(selectedState.config.allowEmailDomains ?? []).join(',')} /></label>
              <label>Deny email domains <input name="denyEmailDomains" defaultValue={(selectedState.config.denyEmailDomains ?? []).join(',')} /></label>
              <label>Percentage <input name="percentageRollout" type="number" min={0} max={100} defaultValue={selectedState.config.percentageRollout} /></label>
              <label>Salt <input name="salt" defaultValue={selectedState.config.salt} /></label>
              {saveError && <p role="alert">{saveError}</p>}
              <button type="submit">Save {selectedEnv}</button>
            </form>

            <section className="card">
              <h3>Evaluation panel</h3>
              <input value={evalUser} onChange={(e) => setEvalUser(e.target.value)} placeholder="user id" />
              <input value={evalEmail} onChange={(e) => setEvalEmail(e.target.value)} placeholder="email (optional)" />
              <input value={evalCountry} onChange={(e) => setEvalCountry(e.target.value)} placeholder="country" />
              <button onClick={runEval}>Evaluate</button>
              {evalResult && <pre>{JSON.stringify(evalResult, null, 2)}</pre>}
            </section>

            <section className="card">
              <h3>Audit history</h3>
              {audit.slice(0, 10).map((item) => (
                <p key={item.id}>{item.environment} v{item.version} by {item.actor} - {item.reason}</p>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
