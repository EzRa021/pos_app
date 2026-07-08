// ============================================================================
// useAppUpdater — checks GitHub Releases (via tauri-plugin-updater) for a new
// version, downloads it silently in the background, and only prompts the
// user to restart once the update is fully downloaded and verified.
//
// Design intent (POS-specific):
//   • Never interrupt an active sale — checking/downloading is silent.
//   • Only surface UI once the update is "ready" (downloaded + signature
//     verified) and installing just needs a relaunch.
//   • Errors from the silent startup check are swallowed (logged only) so a
//     flaky network never shows a scary error to a cashier. The manual
//     "Check for updates" button in Settings surfaces errors instead.
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export function useAppUpdater() {
  const [status, setStatus] = useState('idle'); // idle | checking | downloading | ready | error | up-to-date
  const [updateInfo, setUpdateInfo] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const checkForUpdates = useCallback(async (silent = true) => {
    if (inFlight.current) return null;
    inFlight.current = true;

    try {
      setStatus('checking');
      setError(null);
      const update = await check();

      if (!update) {
        setStatus('up-to-date');
        inFlight.current = false;
        return null;
      }

      setUpdateInfo(update);
      setStatus('downloading');

      let downloaded = 0;
      let total = 0;

      await update.download((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength ?? 0;
            setProgress(total ? Math.round((downloaded / total) * 100) : 0);
            break;
          case 'Finished':
            setProgress(100);
            break;
          default:
            break;
        }
      });

      // Downloaded + signature-verified. Do NOT auto-install/relaunch —
      // wait for the user (or an idle moment) to avoid killing an open shift.
      setStatus('ready');
      inFlight.current = false;
      return update;
    } catch (err) {
      console.error('[useAppUpdater] check/download failed:', err);
      setError(err?.message ?? String(err));
      setStatus(silent ? 'idle' : 'error'); // silent checks fail quietly
      inFlight.current = false;
      return null;
    }
  }, []);

  const installNow = useCallback(async () => {
    if (!updateInfo) return;
    try {
      await updateInfo.install();
      await relaunch();
    } catch (err) {
      console.error('[useAppUpdater] install failed:', err);
      setError(err?.message ?? String(err));
      setStatus('error');
    }
  }, [updateInfo]);

  // Silent background check shortly after launch — gives the app time to
  // finish DB connect / auth restore first so it doesn't compete for
  // startup bandwidth.
  useEffect(() => {
    const timer = setTimeout(() => checkForUpdates(true), 8000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  return { status, updateInfo, progress, error, checkForUpdates, installNow };
}
