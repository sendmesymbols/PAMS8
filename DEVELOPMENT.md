# PAMS8 — Development Environment

PAMS8 ships with its **own embedded Node.js** so its toolchain is fully isolated from
other projects on this machine (notably the shared `D:\Projects\GenAI\PredictionEngine\node24`
install). Nothing here depends on, or modifies, the `node`/`npm` on your PATH or anything `fnm`
has activated. No surprises at demo time.

## One-time setup

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

This downloads the pinned Node (**v24.14.1**, see `.node-version`) into `node\` and runs
`npm install` with it. It's re-runnable and idempotent.

## Daily use

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `.\dev.cmd`      | Vite dev server (port 3000)                   |
| `.\build.cmd`    | Production build (`vite build` + `tsc`)       |
| `.\preview.cmd`  | Preview the built bundle                      |
| `.\pn.cmd <...>` | Run any npm command, e.g. `.\pn.cmd install`  |

PowerShell-native equivalent: `.\pn.ps1 run dev`, `.\pn.ps1 run build`, etc.

## How the isolation works

Each wrapper prepends `node\` and `node_modules\.bin\` to `PATH` **only inside its own process**
(`.cmd` via `setlocal`; `.ps1` via save/restore). It then invokes the embedded `node\npm.cmd`
by explicit path. Because the wrappers never write to the persistent/global PATH and always use
the local `node\`, this project can't alter `node24` and `node24` can't alter this project — even
if `fnm` has switched the shell to a different Node.

## Notes

- `node\` is **git-ignored** (regenerable via `setup.ps1`); it is not committed.
- The pinned version lives in `.node-version` and `package.json` `engines`. To bump Node,
  change both and re-run `setup.ps1`.
- `build.cmd`'s `tsc` step has pre-existing baseline type errors (see `CLAUDE.md`); shipping is
  via Vite. A successful Vite bundle is the success criterion.
