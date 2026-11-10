export const total = (xs: ReadonlyArray<number>) => {
  const sum = [0]
  for (const x of xs) sum.push(x)
  return sum
}
