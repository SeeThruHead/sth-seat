import { Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

export type TelemetrySettings = {
  readonly collector: Option.Option<URL>
  readonly serviceName: string
  readonly serviceVersion: string
}

export const telemetryLayer = (settings: TelemetrySettings) =>
  Option.match(settings.collector, {
    onNone: () => Layer.empty,
    onSome: (endpoint) =>
      Otlp.layer({
        baseUrl: endpoint.href.replace(/\/$/, ""),
        resource: { serviceName: settings.serviceName, serviceVersion: settings.serviceVersion },
        loggerMergeWithExisting: true
      }).pipe(Layer.provide([OtlpSerialization.layerJson, FetchHttpClient.layer]))
  })
