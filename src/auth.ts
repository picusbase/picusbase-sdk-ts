import { errorText } from './http.js';
import type { PicusConfig, TokenResponse, User } from './types.js';

// Platform-wide client, used when the deployment has no project-specific OAuth client.
const SYSTEM_CLIENT_ID = 'ca951fce-0229-4207-88e9-f5c5a32bf9e7';
const SESSION_KEY = 'picus_session';
const PKCE_KEY = 'picus_pkce';

type Session = { access_token: string; refresh_token?: string; expires_at: number; client_id: string };
type Pending = { verifier: string; state: string; clientId: string; returnTo?: string };

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export class AuthClient {
  private callbackPromise?: Promise<boolean>;
  private functionToken?: { token: string; expires_at: number };

  constructor(private readonly config: PicusConfig) {}

  /** Redirects to the PicusBase login page; the browser comes back to /callback. */
  async login(): Promise<void> {
    const clientId = this.config.oauthClientId || SYSTEM_CLIENT_ID;
    const verifier = randomString();
    const state = randomString();
    const pending: Pending = { verifier, state, clientId, returnTo: location.pathname + location.search };
    sessionStorage.setItem(PKCE_KEY, JSON.stringify(pending));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${location.origin}/callback`,
      scope: 'openid profile email',
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      state,
    });
    location.assign(`${this.config.authUrl}/auth/oauth/authorize?${params}`);
  }

  /** Call once on startup: finishes the sign-in when the page is /callback. */
  completeLogin(): Promise<boolean> {
    this.callbackPromise ??= this.exchangeCallback();
    return this.callbackPromise;
  }

  logout(): void {
    localStorage.removeItem(SESSION_KEY);
    this.functionToken = undefined;
  }

  currentUser(): User | null {
    const session = this.readSession();
    if (!session) return null;
    try {
      const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { id: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  /** Access token of the signed-in user, refreshed when near expiry. Null when signed out. */
  async accessToken(): Promise<string | null> {
    const session = this.readSession();
    if (!session) return null;
    if (Date.now() < session.expires_at - 30_000) return session.access_token;
    if (!session.refresh_token) {
      this.logout();
      return null;
    }
    try {
      const token = await this.requestToken({
        grant_type: 'refresh_token',
        refresh_token: session.refresh_token,
        client_id: session.client_id,
      });
      this.saveSession({ ...token, refresh_token: token.refresh_token ?? session.refresh_token }, session.client_id);
      return token.access_token;
    } catch {
      this.logout();
      return null;
    }
  }

  /** Token for calling Picus Functions (audience `compute`), exchanged from the access token. */
  async computeToken(): Promise<string | null> {
    const token = await this.accessToken();
    if (!token) return null;
    if (this.functionToken && Date.now() < this.functionToken.expires_at - 30_000) return this.functionToken.token;
    const res = await fetch(`${this.config.authUrl}/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-project-ref': this.config.projectRef,
      },
      body: JSON.stringify({ target_project_ref: this.config.projectRef, target_audience: 'compute' }),
    });
    if (!res.ok) throw new Error(`Could not get a function token: ${await errorText(res)}`);
    const body = (await res.json()) as TokenResponse;
    this.functionToken = { token: body.access_token, expires_at: Date.now() + (body.expires_in ?? 300) * 1000 };
    return this.functionToken.token;
  }

  private async exchangeCallback(): Promise<boolean> {
    if (location.pathname !== '/callback') return false;
    const params = new URLSearchParams(location.search);
    const pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as Pending | null;
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', pending?.returnTo && pending.returnTo !== '/callback' ? pending.returnTo : '/');
    const code = params.get('code');
    if (!pending || !code || params.get('state') !== pending.state) {
      throw new Error(params.get('error_description') ?? 'Invalid sign-in session, please try again');
    }
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      client_id: pending.clientId,
      redirect_uri: `${location.origin}/callback`,
      code_verifier: pending.verifier,
    });
    this.saveSession(token, pending.clientId);
    return true;
  }

  private async requestToken(body: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(`${this.config.authUrl}/auth/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Sign-in failed: ${await errorText(res)}`);
    return (await res.json()) as TokenResponse;
  }

  private readSession(): Session | null {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    } catch {
      return null;
    }
  }

  private saveSession(token: TokenResponse, clientId: string): void {
    const session: Session = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + (token.expires_in ?? 900) * 1000,
      client_id: clientId,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}
