const PROVINCE_DISPLAY_NAME_RULES = new Map([
  ['广西壮族自治区', '广西省'],
  ['广西', '广西省'],
  ['内蒙古自治区', '内蒙古'],
  ['新疆维吾尔自治区', '新疆省'],
  ['新疆维吾尔族自治区', '新疆省'],
  ['新疆', '新疆省'],
]);

const STANDARD_PROVINCE_DISPLAY_NAMES = new Set([
  '北京市',
  '天津市',
  '河北省',
  '山西省',
  '内蒙古',
  '辽宁省',
  '吉林省',
  '黑龙江省',
  '上海市',
  '江苏省',
  '浙江省',
  '安徽省',
  '福建省',
  '江西省',
  '山东省',
  '河南省',
  '湖北省',
  '湖南省',
  '广东省',
  '广西省',
  '海南省',
  '重庆市',
  '四川省',
  '贵州省',
  '云南省',
  '西藏自治区',
  '陕西省',
  '甘肃省',
  '青海省',
  '宁夏回族自治区',
  '新疆省',
  '香港特别行政区',
  '澳门特别行政区',
  '台湾省',
]);

const SPECIAL_PROVINCE_DISPLAY_NAMES = new Set(['海外', '未设置', '未填写']);

export function provinceDisplayName(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return PROVINCE_DISPLAY_NAME_RULES.get(normalized) || normalized;
}

export function isStandardProvinceDisplayName(value) {
  const displayName = provinceDisplayName(value) || '未设置';
  return STANDARD_PROVINCE_DISPLAY_NAMES.has(displayName) || SPECIAL_PROVINCE_DISPLAY_NAMES.has(displayName);
}
