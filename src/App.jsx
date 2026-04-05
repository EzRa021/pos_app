// ============================================================================
// APP.JSX — Root component
//
// Startup flow:
//   1. isChecking                        => Splash
//        (DB connect → API ready → onboarding check + session restore in parallel)
//   2. config === false                  => SetupWizard (DB never configured)
//   3. connectFailed                     => ConnectionError (re-enter server address)
//   4. apiReady, !isInitialized          => Splash (auth store still initialising)
//   5. !onboardingComplete               => OnboardingFlow (no business in DB yet)
//   6. onboarding done, !user            => LoginScreen (no valid session)
//   7. user ok, !isBranchInitialized     => Splash (loading store data)
//   8. user ok, needsPicker              => StorePicker
//   9. All clear                         => RouterProvider (main POS)
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { useQueryClient }               from '@tanstack/react-query';
import { invoke }              from '@tauri-apps/api/core';
import { getCurrentWindow }    from '@tauri-apps/api/window';
import { RouterProvider }      from 'react-router-dom';
import { AlertCircle, Loader2, LogIn, Eye, EyeOff, RefreshCw, Settings } from 'lucide-react';

import SetupWizard, { CONFIG_KEY } from './features/setup/SetupWizard';
import { PinLockScreen }           from './features/auth/PinLockScreen';
import { RealtimeProvider }        from './providers/RealtimeProvider';

const ONBOARDING_CACHE_KEY = 'qpos_onboarding_done';
import StorePicker                 from './features/auth/StorePicker';
import router                      from './router';
import { OnboardingFlow }          from './features/onboarding/OnboardingFlow';
import { useAuthStore }  from './stores/auth.store';
import { useBranchStore } from './stores/branch.store';
import { apiClient, setApiBaseUrl } from './lib/apiClient';
import { TitleBar }                from './components/layout/TitleBar';
import { Button }                  from './components/ui/button';
import { Input }                   from './components/ui/input';
import { Separator }               from './components/ui/separator';
import './App.css';

function setWindowBg(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.background = hex;
  document.body.style.background = hex;
  getCurrentWindow().setBackgroundColor({ r, g, b, a: 255 }).catch(() => {});
}

// ── Shared wrapper ────────────────────────────────────────────────────────────
// Uses h-full instead of min-h-screen — it lives inside the flex-1 content
// area below the TitleBar, so h-full fills exactly the remaining viewport.
function ScreenShell({ children, className }) {
  return (
    <div className={`h-full w-full bg-background flex flex-col items-center justify-center p-4 ${className ?? ""}`}>
      <div className="w-full max-w-sm">
        {children}
        <p className="text-center text-[11px] text-muted-foreground mt-5">
          Quantum POS © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

// ── Logo block ────────────────────────────────────────────────────────────────
function Brand({ iconClassName = "bg-primary/15 border-primary/20", iconContent, subtitle }) {
  return (
    <div className="flex flex-col items-center gap-3 mb-2">
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${iconClassName}`}>
        {iconContent ?? <span className="text-2xl font-bold text-primary">Q</span>}
      </div>
      <div className="text-center">
        <h1 className="text-lg font-bold text-foreground tracking-tight">Quantum POS</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Splash ────────────────────────────────────────────────────────────────────
function Splash() {
  return (
    <div className="h-full w-full bg-background flex items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── Connection Error ──────────────────────────────────────────────────────────
function ConnectionError({ config, onRetry, onReconfigure }) {
  return (
    <ScreenShell>
      <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-8 flex flex-col gap-6 animate-fade-in">
        <Brand
          iconClassName="bg-destructive/10 border-destructive/20"
          iconContent={<AlertCircle className="h-7 w-7 text-destructive" />}
          subtitle="Server Unreachable"
        />

        <div className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-center">
          <p className="text-xs text-destructive font-medium">
            Cannot connect to{' '}
            <span className="font-mono font-bold">
              {config.host}:{config.apiPort ?? 4000}
            </span>
          </p>
          <p className="text-[11px] text-destructive/80 mt-1">
            Make sure the server is running and reachable on the network.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={onRetry} className="w-full" size="lg">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
          <Button variant="outline" onClick={onReconfigure} className="w-full" size="lg">
            <Settings className="h-4 w-4" />
            Change Server
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ config }) {
  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  const [showPass,  setShowPass]  = useState(false);

  const login      = useAuthStore(s => s.login);
  const isLoading  = useAuthStore(s => s.isLoading);
  const error      = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();
    try { await login(username, password); } catch { /* error in store */ }
  }

  const modeLabel = config.mode === 'server'
    ? 'Server Terminal'
    : `Client → ${config.host}:${config.apiPort ?? 4000}`;

  return (
    <ScreenShell>
      <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-8 flex flex-col gap-6 animate-fade-in">
        {/* Brand */}
        <Brand subtitle={modeLabel} />

        <Separator className="bg-border" />

        {/* Form */}
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">Sign in to your account</h2>
          <p className="text-xs text-muted-foreground">Enter your credentials to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Username</label>
            <Input
              value={username}
              onChange={e => { setUsername(e.target.value); clearError(); }}
              placeholder="admin"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Password</label>
            <div className="relative">
              <Input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); clearError(); }}
                placeholder="Password"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full h-11 mt-1" disabled={isLoading}>
            {isLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Signing in…</>
              : <><LogIn className="h-4 w-4" />Sign In</>}
          </Button>
        </form>

        {import.meta.env.DEV && (
          <p className="text-center text-[11px] text-muted-foreground">
            Default: <span className="font-mono text-foreground">admin</span> /{' '}
            <span className="font-mono text-foreground">Admin@123</span>
          </p>
        )}
      </div>
    </ScreenShell>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [config,             setConfig]             = useState(null);
  const [apiReady,           setApiReady]           = useState(false);
  const [connectFailed,      setConnectFailed]      = useState(false);
  const [isChecking,         setIsChecking]         = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(null); // null = not yet checked
  const [onboardingStatus,   setOnboardingStatus]   = useState(null); // full status object
  // Prevents React Strict Mode’s double-invoke of useEffect from starting two
  // concurrent initConnection calls, which would race and could leave the app
  // on the login screen even with a valid refresh token.
  const initInProgress = useRef(false);

  // Read only primitive/stable values from stores — never objects or functions
  // as selector return values (new object refs cause infinite re-render loops).
  const queryClient         = useQueryClient();
  const user                = useAuthStore(s => s.user);
  const isInitialized       = useAuthStore(s => s.isInitialized);
  const restoreSession      = useAuthStore(s => s.restoreSession);
  const isPosLocked         = useAuthStore(s => s.isPosLocked);
  const unlockPos           = useAuthStore(s => s.unlockPos);
  const isBranchInitialized = useBranchStore(s => s.isBranchInitialized);
  const needsPicker         = useBranchStore(s => s.needsPicker);

  async function initConnection(savedConfig) {
    setConnectFailed(false);
    setApiReady(false);
    setIsChecking(true);
    setConfig(savedConfig);

    try {
      if (savedConfig.mode === 'server') {
        // ── Server mode ────────────────────────────────────────────────────
        // Check whether the Rust backend already has a live DB pool.
        // On a WebView reload the Tauri process keeps running — the pool
        // is still open and db_status returns connected:true, so we skip
        // db_connect (and migrations) entirely.
        // On a full app restart AppState.db starts as None, so we reconnect
        // silently using the saved credentials — no setup wizard shown.
        const status = await invoke('db_status').catch(() => ({ connected: false }));

        if (!status.connected) {
          await invoke('db_connect', {
            config: {
              host:     savedConfig.host,
              port:     savedConfig.port,
              username: savedConfig.username,
              password: savedConfig.password,
              database: savedConfig.database,
            },
          });
        }

        // The HTTP API server is spawned as an async task in setup().
        // Poll until it reports a real port (> 0), giving it up to 5 s.
        let apiPort = 0;
        for (let attempt = 0; attempt < 50 && !apiPort; attempt++) {
          apiPort = await invoke('get_api_port').catch(() => 0);
          if (!apiPort) await new Promise(r => setTimeout(r, 100));
        }
        if (!apiPort) throw new Error('API server did not start in time');
        setApiBaseUrl(`http://localhost:${apiPort}`);

        // Persist the resolved port so client terminals can read it.
        const updated = { ...savedConfig, apiPort, setupComplete: true };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
        setConfig(updated);

      } else {
        // ── Client mode ────────────────────────────────────────────────────
        // Always health-check — the remote server might have restarted or
        // moved, and we need to know before letting the user into the app.
        const { host, apiPort = 4000 } = savedConfig;
        setApiBaseUrl(`http://${host}:${apiPort}`);
        const res = await fetch(`http://${host}:${apiPort}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
      }

      setApiReady(true);

      // ── Wait for HTTP server to be truly ready ──────────────────────────────
      // get_api_port() returns as soon as the port number is assigned, but the
      // Axum server is started in a separate async task and may not be accepting
      // TCP connections yet. Poll /health until it responds (up to 10 s) before
      // making any RPC calls.
      const baseUrl = apiClient.defaults.baseURL;
      let serverReady = false;
      for (let attempt = 0; attempt < 20 && !serverReady; attempt++) {
        try {
          const res = await fetch(`${baseUrl}/health`, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) serverReady = true;
        } catch { /* not ready yet */ }
        if (!serverReady) await new Promise(r => setTimeout(r, 100));
      }

      if (!serverReady) throw new Error('API server did not respond in time');

      // ── Run onboarding check + session restore in parallel ──────────────────
      // Both resolve before we clear isChecking so the user sees one clean
      // transition: splash → onboarding | login | dashboard.
      //
      // Onboarding status is cached in localStorage so a transient API error
      // never incorrectly shows the OnboardingFlow to a user who already
      // completed setup (which would require a Ctrl+R to recover from).
      const cachedOnboardingDone = localStorage.getItem(ONBOARDING_CACHE_KEY) === 'true';
      const [onboardingResult] = await Promise.all([
        // 1. Onboarding status — fall back to the cached value on error so a
        //    transient HTTP failure doesn't send the user back to onboarding.
        apiClient.post('/api/rpc', { method: 'check_onboarding_status', params: {} })
          .then(({ data }) => data)
          .catch(() => ({ complete: cachedOnboardingDone, needs_super_admin: false })),
        // 2. Session restore (sets user in auth store if token is valid)
        restoreSession().catch(() => {}),
      ]);

      const isComplete = onboardingResult?.complete === true;
      if (isComplete) localStorage.setItem(ONBOARDING_CACHE_KEY, 'true');
      setOnboardingComplete(isComplete);
      setOnboardingStatus(onboardingResult);
      setIsChecking(false);
    } catch {
      setConnectFailed(true);
      setIsChecking(false);
    }
  }

  useEffect(() => {
    // Guard: React Strict Mode fires this effect twice in dev. The second call
    // must be a no-op — the ref persists across both invocations because Strict
    // Mode does NOT reset refs between the simulated unmount and remount.
    if (initInProgress.current) return;
    initInProgress.current = true;

    const saved = localStorage.getItem(CONFIG_KEY);
    if (!saved) { setConfig(false); setIsChecking(false); return; }
    try {
      const parsed = JSON.parse(saved);
      if (!parsed?.setupComplete) { setConfig(false); setIsChecking(false); return; }
      initConnection(parsed);
    } catch {
      setConfig(false);
      setIsChecking(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: Branch and shift initialization are NO LONGER triggered from here.
  // auth.store.login / restoreSession call useBranchStore.getState().initForUser()
  // directly (outside React's commit phase), which in turn calls
  // useShiftStore.getState().initForStore(). This eliminates the
  // forceStoreRerender / "Maximum update depth exceeded" crash that occurred
  // when store actions with synchronous set() calls were invoked from useEffect.

  useEffect(() => {
    const screen =
      isChecking ? 'loading'
      : !config || connectFailed ? 'setup'
      : !user ? 'login'
      : 'main';
    const colors = { loading: '#09090b', setup: '#09090b', login: '#09090b', main: '#09090b' };
    setWindowBg(colors[screen]);
  }, [isChecking, apiReady, connectFailed, config, user]);

  // ── Screen resolution ─────────────────────────────────────────────────────
  let content;
  if      (isChecking)                  content = <Splash />;
  else if (!config)                     content = <SetupWizard onComplete={(cfg) => initConnection(cfg)} />;
  else if (connectFailed)               content = (
    <ConnectionError
      config={config}
      onRetry={() => initConnection(config)}
      onReconfigure={() => {
        localStorage.removeItem(CONFIG_KEY);
        setConfig(false);
        setConnectFailed(false);
      }}
    />
  );
  else if (!apiReady || !isInitialized) content = <Splash message="Connecting…" />;
  else if (onboardingComplete === false)  content = (
    <OnboardingFlow
      resumeBusinessName={onboardingStatus?.business_name ?? ''}
      resumeBusinessId={  onboardingStatus?.business_id   ?? ''}
      resumeAtSuperAdmin={onboardingStatus?.needs_super_admin === true}
      onComplete={() => {
        localStorage.setItem(ONBOARDING_CACHE_KEY, 'true');
        setOnboardingComplete(true);
        // Immediately refresh the business info query so the sidebar
        // and SyncStatusBadge show the new business name without waiting.
        queryClient.invalidateQueries({ queryKey: ['business-info'] });
      }}
    />
  );
  else if (!user)                       content = <LoginScreen config={config} />;
  else if (!isBranchInitialized)        content = <Splash message="Loading branch data…" />;
  else if (needsPicker)                 content = <StorePicker />;
  else                                  content = <RouterProvider router={router} />;

  const userName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
    : undefined;

  return (
    <RealtimeProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Custom title bar — always visible, always on top */}
        <TitleBar />
        {/* Main content area fills remaining height */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {content}
        </div>
        {/* Global PIN lock overlay — covers every page when screen is locked */}
        {user && isPosLocked && (
          <PinLockScreen onUnlock={unlockPos} userName={userName} />
        )}
      </div>
    </RealtimeProvider>
  );
}
