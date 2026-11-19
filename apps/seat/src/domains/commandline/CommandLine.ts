const asOneWord = (argument: string) => `'${argument.replaceAll("'", `'\\''`)}'`

const isAlreadyACommandLine = (given: ReadonlyArray<string>) => given.length === 1

export const commandLine = (given: ReadonlyArray<string>): string =>
  isAlreadyACommandLine(given) ? given.join("") : given.map(asOneWord).join(" ")
