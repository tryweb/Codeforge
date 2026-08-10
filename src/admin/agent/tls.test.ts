import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTlsFiles, resolveTlsConfig } from "./tls";

describe("agent TLS configuration", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-engkit-agent-tls-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("is configured when every certificate path exists", () => {
    const caPath = join(temporaryDirectory, "ca.pem");
    const clientCertPath = join(temporaryDirectory, "client.pem");
    const clientKeyPath = join(temporaryDirectory, "client-key.pem");
    writeFileSync(caPath, "ca");
    writeFileSync(clientCertPath, "client-cert");
    writeFileSync(clientKeyPath, "client-key");

    const config = resolveTlsConfig({
      CENTER_CA_CERT: caPath,
      CENTER_CLIENT_CERT: clientCertPath,
      CENTER_CLIENT_KEY: clientKeyPath,
    });

    expect(config).toEqual({
      ca: caPath,
      clientCert: clientCertPath,
      clientKey: clientKeyPath,
      configured: true,
    });
  });

  it("is not configured when certificate settings are partial", () => {
    const caPath = join(temporaryDirectory, "ca.pem");
    writeFileSync(caPath, "ca");

    const config = resolveTlsConfig({ CENTER_CA_CERT: caPath });

    expect(config).toEqual({
      ca: caPath,
      clientCert: null,
      clientKey: null,
      configured: false,
    });
  });

  it("is not configured when certificate settings are absent", () => {
    const config = resolveTlsConfig({});

    expect(config).toEqual({
      ca: null,
      clientCert: null,
      clientKey: null,
      configured: false,
    });
  });

  it("is not configured when a configured path does not exist", () => {
    const caPath = join(temporaryDirectory, "ca.pem");
    const clientCertPath = join(temporaryDirectory, "client.pem");
    const clientKeyPath = join(temporaryDirectory, "missing-key.pem");
    writeFileSync(caPath, "ca");
    writeFileSync(clientCertPath, "client-cert");

    const config = resolveTlsConfig({
      CENTER_CA_CERT: caPath,
      CENTER_CLIENT_CERT: clientCertPath,
      CENTER_CLIENT_KEY: clientKeyPath,
    });

    expect(config.configured).toBe(false);
  });

  it("reads certificate contents at call time", async () => {
    const caPath = join(temporaryDirectory, "ca.pem");
    const clientCertPath = join(temporaryDirectory, "client.pem");
    const clientKeyPath = join(temporaryDirectory, "client-key.pem");
    writeFileSync(caPath, "old-ca");
    writeFileSync(clientCertPath, "old-client-cert");
    writeFileSync(clientKeyPath, "old-client-key");
    const config = resolveTlsConfig({
      CENTER_CA_CERT: caPath,
      CENTER_CLIENT_CERT: clientCertPath,
      CENTER_CLIENT_KEY: clientKeyPath,
    });
    writeFileSync(caPath, "rotated-ca");
    writeFileSync(clientCertPath, "rotated-client-cert");
    writeFileSync(clientKeyPath, "rotated-client-key");

    const contents = await readTlsFiles(config);

    expect(contents).toEqual({
      ca: "rotated-ca",
      clientCert: "rotated-client-cert",
      clientKey: "rotated-client-key",
    });
  });

  it("returns null content for unset certificate paths", async () => {
    const caPath = join(temporaryDirectory, "ca.pem");
    writeFileSync(caPath, "ca");
    const config = resolveTlsConfig({ CENTER_CA_CERT: caPath });

    const contents = await readTlsFiles(config);

    expect(contents).toEqual({ ca: "ca", clientCert: null, clientKey: null });
  });
});
