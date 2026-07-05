# Kiosk mode (dedicated Mac Mini)

Run the ops dashboard as an always-on, fullscreen kiosk that boots into the
dashboard, keeps the backend running, and auto-updates itself from `main`.

This is host tooling around the normal deployment (`make deploy`). It does not
change the app runtime. See `DEPLOY.md` for the underlying deploy.

## What it does

- **Fixed URL** — the kind cluster maps `http://localhost:8080` (loopback only)
  to the UI, so no `kubectl port-forward` is needed.
- **Boot bootstrap** — waits for Docker, ensures the cluster, deploys if needed.
- **Kiosk browser** — launches Chrome fullscreen showing only the dashboard, and
  relaunches it if it is closed; keeps the display awake.
- **Auto-update** — every 5 minutes: if `origin/main` has new commits that
  fast-forward, it pulls, builds, runs the tests, redeploys **only if green**,
  and reloads the browser. A bad or force-pushed commit is never deployed, and
  `.env` is never touched.

## One-time setup on the Mac Mini

1. **Clone + configure** the repo, and create `.env` with the real secrets
   (see `DEPLOY.md`). `.env` is gitignored and is never modified by auto-update.

2. **Install prerequisites**: Docker Desktop, `kubectl`, `kind`, Node.js, and
   Google Chrome.

3. **Recreate the cluster with the fixed port mapping.** A pre-existing kind
   cluster created without the mapping must be recreated (destructive; redeploy
   after):

   ```bash
   kind delete cluster --name kind   # only if one exists without the mapping
   make cluster-up                   # creates it from k8s/kind-cluster.yaml
   make deploy
   open http://localhost:8080        # verify the dashboard loads
   ```

4. **Install the kiosk agents:**

   ```bash
   make kiosk-install
   ```

   Then check everything is wired up:

   ```bash
   make kiosk-doctor
   ```

5. **Apply the macOS settings that cannot be scripted:**
   - **Automatic login** — System Settings → Users & Groups → Automatically log
     in as this user.
   - **Docker at login** — Docker Desktop → Settings → General → *Start Docker
     Desktop when you sign in*.
   - **No display sleep** — System Settings → Displays (and Battery/Energy) →
     set *Turn display off* to Never. (`caffeinate` also holds it awake while the
     kiosk runs.)
   - **Automation permission** — on the first auto-update after a UI change,
     approve the prompt to let the updater control Google Chrome (so it can
     reload the tab). If missed, enable it under System Settings → Privacy &
     Security → Automation.

6. **Reboot** to verify the full flow, or start immediately:

   ```bash
   bash scripts/kiosk/bootstrap.sh
   launchctl start com.fansfund.dashboard.kiosk
   ```

## Configuration

Environment variables (set them in the LaunchAgent env or before install):

| Variable | Default | Purpose |
|---|---|---|
| `KIOSK_URL` | `http://localhost:8080` | Dashboard URL the kiosk opens |
| `KIOSK_BRANCH` | `main` | Branch auto-update tracks |
| `KIOSK_UPDATE_INTERVAL_SECONDS` | `300` | Auto-update check interval |
| `KIOSK_CHROME` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome binary |
| `KIOSK_CHROME_PROFILE` | `~/.fansfund-kiosk-chrome` | Dedicated Chrome profile dir |

## Operating it

```bash
# Verify the device is set up correctly (read-only diagnostics):
make kiosk-doctor

# Dry-run the auto-update decision (no pull/deploy):
bash scripts/kiosk/auto-update.sh --check

# Logs:
tail -f ~/Library/Logs/fansfund-dashboard/com.fansfund.dashboard.autoupdate.out.log
tail -f ~/Library/Logs/fansfund-dashboard/com.fansfund.dashboard.kiosk.err.log

# Force an update check now:
launchctl start com.fansfund.dashboard.autoupdate

# Restart the kiosk browser:
launchctl kickstart -k gui/$(id -u)/com.fansfund.dashboard.kiosk

# Remove all kiosk agents (leaves the deployment running):
make kiosk-uninstall
```

## Notes / limitations

- The engine stays a ClusterIP service (unauthenticated by design); only the UI
  is exposed, and only on loopback. Keep the machine on a trusted network.
- Auto-update only **fast-forwards** `main`. If history diverges (e.g. a force
  push), it logs and stops so a human can reconcile — it will not reset local
  state.
- The end-to-end boot/kiosk behaviour must be verified on the device; it cannot
  be exercised in CI.

## Troubleshooting

**Auto-update never deploys pushed commits.** Run `make kiosk-doctor` — it
checks the branch and whether git can reach the remote. The usual cause is
**git credentials**: fetching works in your terminal (macOS keychain / an
`ssh-agent` you started) but the auto-update runs from `launchd`, a
non-interactive session with none of that. Fixes:

- Use an **HTTPS remote** and store a token in the login keychain so
  `git-credential-osxkeychain` serves it non-interactively:
  `git config --global credential.helper osxkeychain`, then do one manual
  `git fetch` and enter the token when prompted.
- Or use an **SSH deploy key** whose private key needs no passphrase (or is in
  the keychain), so `git@…` works without an agent.

Also confirm the checkout is on `main`, and read the log at
`~/Library/Logs/fansfund-dashboard/com.fansfund.dashboard.autoupdate.err.log` —
the fetch error is now written there verbatim.

**Force a check now:** `bash scripts/kiosk/auto-update.sh` (or `--check` for a
dry run that only reports the decision).
