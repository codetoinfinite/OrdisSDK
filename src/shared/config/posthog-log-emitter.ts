import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

type LogSeverity = "info" | "warn" | "error";

export interface PostHogLogEmitter {
  emit(severityText: LogSeverity, body: string, attributes?: Record<string, string>): void;
}

const noOpLogEmitter: PostHogLogEmitter = {
  emit() {},
};

export function createPostHogLogEmitter(): PostHogLogEmitter {
  const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;

  if (!projectToken || !host) {
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG) {
      const missingVariable = projectToken ? "POSTHOG_HOST" : "POSTHOG_PROJECT_TOKEN";
      throw new Error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }

    return noOpLogEmitter;
  }

  const exporter = new OTLPLogExporter({
    url: `${host.replace(/\/$/, "")}/i/v1/logs`,
    headers: { Authorization: `Bearer ${projectToken}` },
  });
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": "alphesdk-registry" }),
    processors: [new BatchLogRecordProcessor({ exporter })],
  });
  const logger = provider.getLogger("posthog-registry-lifecycle");

  return {
    emit(severityText, body, attributes) {
      logger.emit({ severityText, body, attributes });
    },
  };
}
