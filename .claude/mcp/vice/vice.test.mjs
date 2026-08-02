// node:test coverage of vice.mjs's serverInfo() deny-list stripping --
// rescued from vice-pool.test.mjs (quick-260730 series) before that file is
// deleted wholesale in plan 04. vice.mjs's LIBRARY exports (call(),
// useInstance(), serverInfo(), activeInstance(), DENY_LIST) survive D-02/
// D-05 -- only the CLI subcommand surface (including formatToolsOutput(),
// which has no caller left once the CLI is deleted) goes with the pool
// subsystem's deletion in plan 04. Nothing here imports vice-pool.mjs or
// vice-session.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { useInstance, serverInfo, activeInstance } from "./vice.mjs";

test("serverInfo() strips DENY_LIST tools from discovery: a server that advertises vice_disk_list yields a payload with no trace of it, in the object and in a JSON dump alike", async () => {
  // A stub speaking just enough MCP to answer initialize + tools/list. The
  // server deliberately DOES advertise the forbidden tool -- the property
  // under test is that the seam removes it, not that the server hides it.
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const msg = JSON.parse(body);
      const result =
        msg.method === "initialize"
          ? { protocolVersion: "2024-11-05" }
          : {
              tools: [
                { name: "vice_ping", description: "Ping the server" },
                { name: "vice_disk_list", description: "List files on a disk" },
                { name: "vice_memory_read", description: "Read memory" },
              ],
            };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  // Captured before mutating the seam, so it can be restored in `finally`
  // without depending on vice-pool.mjs's DEFAULT_PORT/instanceFor (both
  // deleted per D-02) -- activeInstance()/useInstance() are the whole
  // surviving public contract for redirecting and restoring the seam.
  const originalInstance = activeInstance();
  try {
    useInstance({ port, url: `http://127.0.0.1:${port}/mcp` });
    const info = await serverInfo();
    const names = info.tools.map((t) => t.name);

    assert.ok(!names.includes("vice_disk_list"), "the forbidden tool must not survive discovery");
    assert.deepEqual(names, ["vice_ping", "vice_memory_read"], "every other tool passes through untouched");

    // "in the JSON dump alike": plain JSON.stringify() of the SAME payload
    // serverInfo() returns, not formatToolsOutput()'s --json rendering --
    // that CLI-only helper has no caller left once vice.mjs's CLI is deleted
    // per D-05 (plan 04), so this rescue does not depend on it surviving.
    assert.ok(!JSON.stringify(info).includes("vice_disk_list"), "the forbidden tool must not survive a JSON dump of the payload either");
  } finally {
    srv.close();
    useInstance(originalInstance);
  }
});
