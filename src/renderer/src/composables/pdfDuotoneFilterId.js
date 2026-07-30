let filterSequence = 0

export function createPdfDuotoneFilterId() {
  filterSequence += 1
  return `pdf-duotone-filter-${filterSequence}`
}
