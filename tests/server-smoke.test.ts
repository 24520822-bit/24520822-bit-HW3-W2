import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createServer } from "../src/server";

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  server = undefined;
});

it("starts the HTTP server and answers the health check", async () => {
  server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an internet socket address");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});
