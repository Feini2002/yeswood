const TERMINAL_PROJECT_STATUSES = new Set(['已完成', '完成', '已取消', '取消', '关闭', '已关闭']);
const PROJECT_STATUS_FIELD_NAMES = ['项目状态', '状态', 'status'];

export function normalizeProjectStatusText(value) {
  if (value && typeof value === 'object') {
    const preferred = value.display ?? value.text ?? value.name ?? value.title ?? value.label ?? value.value;
    if (preferred !== undefined && preferred !== value) {
      return normalizeProjectStatusText(preferred);
    }
  }
  return String(value ?? '').trim();
}

function normalizeProjectStatusKey(value) {
  return normalizeProjectStatusText(value).toLowerCase();
}

function readStatusCellValue(cell) {
  if (cell && typeof cell === 'object') {
    return cell.display ?? cell.displayValue ?? cell.text ?? cell.name ?? cell.title ?? cell.label ?? cell.value ?? '';
  }
  return cell;
}

export function isTerminalProjectStatus(value) {
  const status = normalizeProjectStatusText(value);
  return TERMINAL_PROJECT_STATUSES.has(status);
}

export function readProjectStatusFromRawFields(rawFields = {}, fallback = '') {
  for (const fieldName of PROJECT_STATUS_FIELD_NAMES) {
    const status = normalizeProjectStatusText(readStatusCellValue(rawFields[fieldName]));
    if (status) {
      return status;
    }
  }
  const entries = Object.entries(rawFields);
  for (const fieldName of PROJECT_STATUS_FIELD_NAMES) {
    const needle = normalizeProjectStatusKey(fieldName);
    const matches = entries.filter(([key, cell]) => {
      return normalizeProjectStatusKey(key) === needle && normalizeProjectStatusText(readStatusCellValue(cell));
    });
    if (matches.length === 1) {
      return normalizeProjectStatusText(readStatusCellValue(matches[0][1]));
    }
  }
  return normalizeProjectStatusText(fallback);
}
