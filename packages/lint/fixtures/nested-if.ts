export const classify = (a: boolean, b: boolean) => {
  if (a) {
    if (b) return "both"
  }
  return "neither"
}
