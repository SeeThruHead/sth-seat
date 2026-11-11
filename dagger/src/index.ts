import { dag, Directory, object, func } from "@dagger.io/dagger"

@object()
export class SthSeatCi {
  @func()
  async check(source: Directory): Promise<string> {
    return dag
      .container()
      .from("oven/bun:1.4.2")
      .withExec([
        "sh",
        "-c",
        "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates"
      ])
      .withDirectory("/repo", source, {
        owner: "bun",
        exclude: ["**/node_modules", "**/.data*", "**/.env*", "**/dist", "**/coverage", "dagger/sdk", ".moon/cache"]
      })
      .withUser("bun")
      .withWorkdir("/repo")
      .withEnvVariable("CI", "true")
      .withExec(["git", "config", "--global", "--add", "safe.directory", "/repo"])
      .withExec(["bun", "install", "--frozen-lockfile", "--ignore-scripts"])
      .withExec(["bun", "run", "moon", "run", ":check", "--concurrency", "4"])
      .stdout()
  }
}
