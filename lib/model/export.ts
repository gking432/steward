/** Spreadsheet formula injection is distinct from CSV quoting. */
export function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return `"${safe.replaceAll('"','""')}"`;
}
