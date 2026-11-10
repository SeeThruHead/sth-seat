import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { telemetryLayer } from "@sth-seat/protocol/Telemetry.ts"
import { routes } from "./Definition.ts"
import { readSettings } from "./HubSettings.ts"

const Environment = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  configFile: Config.String("CONFIG_FILE").pipe(Config.withDefault("/config/sth-seat.yaml")),
  revision: Config.String("REVISION").pipe(Config.withDefault("dev")),
  collector: Config.option(Config.URL("OTEL_EXPORTER_OTLP_ENDPOINT"))
})

Effect.gen(function* () {
  const environment = yield* Environment
  const settings = yield* readSettings(environment.configFile)
  yield* Effect.logInfo("starting", {
    port: environment.port,
    machines: settings.machines.map((machine) => machine.name)
  })

  return yield* Layer.launch(
    HttpRouter.serve(routes(settings, environment.revision), { disableLogger: true }).pipe(
      Layer.provide(BunHttpServer.layer({ port: environment.port, gracefulShutdownTimeout: "1 second" })),
      Layer.provide(
        telemetryLayer({
          collector: environment.collector,
          serviceName: "sth-seat",
          serviceVersion: environment.revision
        })
      )
    )
  )
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
