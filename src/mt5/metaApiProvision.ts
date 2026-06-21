// MetaApi provisioning helper — used by the backend/admin to connect a trader's
// MT5 login to MetaApi so the MetaApiAdapter can read it. Call this once per
// account (e.g. when an admin links MT5 credentials), then store the returned
// accountId on Account.mt5AccountId.
//
// Requires METAAPI_TOKEN. This hits MetaApi's provisioning API. Treat it as a
// reference implementation — confirm the current MetaApi API shape for your
// region before production.
//
// Docs: https://metaapi.cloud/docs/provisioning/

const PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.ai';

interface ProvisionParams {
  login: string;        // MT5 account number
  password: string;     // investor (read-only) or master password
  serverName: string;   // broker server, e.g. "ICMarkets-Demo"
  name?: string;        // a label for the account
  region?: string;      // e.g. "new-york", "london"
}

export async function provisionMt5Account(p: ProvisionParams, token = process.env.METAAPI_TOKEN || ''): Promise<string> {
  if (!token) throw new Error('METAAPI_TOKEN is required to provision MT5 accounts');

  const res = await fetch(`${PROVISIONING}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({
      login: p.login,
      password: p.password,
      name: p.name ?? `INDPIPS ${p.login}`,
      server: p.serverName,
      platform: 'mt5',
      magic: 0,
      region: p.region ?? process.env.METAAPI_REGION ?? 'new-york',
      // "cloud-g2" is MetaApi's standard reliability tier; "cloud" also works.
      reliability: 'regular',
    }),
  });
  if (!res.ok) throw new Error(`MetaApi provision ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };

  // Deploy the account so MetaApi connects to the broker.
  await fetch(`${PROVISIONING}/users/current/accounts/${data.id}/deploy`, {
    method: 'POST',
    headers: { 'auth-token': token },
  }).catch(() => undefined);

  return data.id; // store this on Account.mt5AccountId
}

/** Remove a MetaApi account (e.g. when a challenge ends). */
export async function deprovisionMt5Account(accountId: string, token = process.env.METAAPI_TOKEN || ''): Promise<void> {
  if (!token) return;
  await fetch(`${PROVISIONING}/users/current/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { 'auth-token': token },
  }).catch(() => undefined);
}
