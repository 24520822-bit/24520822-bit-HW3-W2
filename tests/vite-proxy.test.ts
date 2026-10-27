import { expect, it } from "vitest";
import viteConfig from "../vite.config";

it("proxies API calls through both Vite development and preview servers", () => {
  const devProxy = viteConfig.server?.proxy?.["/api"];
  const previewProxy = viteConfig.preview?.proxy?.["/api"];

  expect(devProxy).toMatchObject({ target: "http://127.0.0.1:3000" });
  expect(previewProxy).toMatchObject({ target: "http://127.0.0.1:3000" });
});
