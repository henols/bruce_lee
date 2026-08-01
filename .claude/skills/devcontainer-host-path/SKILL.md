---
name: devcontainer-host-path
description: Build the host path for a file in this workspace, so tools running outside the devcontainer can open it. Use whenever a host-side MCP server, app, emulator, viewer or debugger needs the location of an artifact that lives here — disk images, programs, screenshots, symbol files, configs — and whenever such a tool asks for a path.
---

# Host paths for workspace files

Translate the path first, then hand the result to the outside tool:

```bash
node .claude/skills/devcontainer-host-path/scripts/hostpath.mjs --plain <file>   # path only
node .claude/skills/devcontainer-host-path/scripts/hostpath.mjs <file>           # fuller report
```

```
$ node .claude/skills/devcontainer-host-path/scripts/hostpath.mjs --plain disks/game.d64
/home/henrik/code/bruce_lee/disks/game.d64
```

Pass that as the tool's `path` argument. `--plain` prints one path per line, best
first, for feeding straight into another command:

```bash
HP=$(node .claude/skills/devcontainer-host-path/scripts/hostpath.mjs --plain build/game.prg | head -1)
```

## From a script

```js
import { hostPath, tryHostPaths } from "../../devcontainer-host-path/scripts/hostpath.mjs";

hostPath("build/game.prg");   // the host path

// Hands each candidate to the consumer until one works.
const { result, hostPath: used } = await tryHostPaths(file, (p) => hostTool({ path: p }));
```

`node hostpath.mjs --help` lists the rest.

## Working notes

- Keep artifacts destined for a host-side tool **inside the workspace**, and they
  translate.
- To get a file *back* from a host-side tool, give it a translated workspace path
  to write to, then read that file normally in the container. When the tool offers
  to return the bytes instead (base64, stdout), take that — no path needed.

## The other direction

A host-side process sometimes hands YOU its own coordinates back — e.g. the on-demand
VICE broker's grant records, which carry a host-rooted path and a loopback url. Reach
for `containerpath.mjs` (beside `hostpath.mjs`, same directory) to invert them into
container form before adopting them:

```js
import { containerPath, containerHost, containerizeRecord } from "../../devcontainer-host-path/scripts/containerpath.mjs";
```
