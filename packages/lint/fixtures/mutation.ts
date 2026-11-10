export const sortInPlace = (xs: Array<number>, target: { count: number }) => {
  xs.sort((a, b) => a - b)
  target.count = 1
  Object.assign(target, { count: 2 })
  return xs
}
