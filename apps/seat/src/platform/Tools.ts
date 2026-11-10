import { Effect, FileSystem, Path } from "effect"

export const onPath = Effect.fnUntraced(function* (tool: string, searchPath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folders = searchPath.split(":").filter((folder) => folder !== "")
  const found = yield* Effect.forEach(folders, (folder) =>
    fs.exists(path.join(folder, tool)).pipe(Effect.orElseSucceed(() => false))
  )

  return found.some((exists) => exists)
})
