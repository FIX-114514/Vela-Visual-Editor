/**
 * 4种目标设备的屏幕配置
 * 数据来源：https://iot.mi.com/vela/quickapp/zh/guide/design/multi-screens.html
 */
export interface DeviceConfig {
  id: string;
  name: string;
  nameCn: string;
  shape: 'circle' | 'rect' | 'capsule';
  width: number;
  height: number;
  dpr: number;
  screenInch: string;
  safeArea?: { top: number; bottom: number; left: number; right: number };
}

export const DEVICES: DeviceConfig[] = [
  {
    id: 'watchs4',
    name: 'Xiaomi Watch S',
    nameCn: '小米手表S系列',
    shape: 'circle',
    width: 466,
    height: 466,
    dpr: 2.0,
    screenInch: '1.43"',
    // 圆形屏安全区域：内切正方形
    safeArea: { top: 66, bottom: 66, left: 66, right: 66 }
  },
  {
    id: 'band9pro',
    name: 'Xiaomi Band Pro',
    nameCn: '小米手环Pro',
    shape: 'rect',
    width: 336,
    height: 480,
    dpr: 2.1,
    screenInch: '1.74"'
  },
  {
    id: 'band9',
    name: 'Xiaomi Band',
    nameCn: '小米手环',
    shape: 'capsule',
    width: 192,
    height: 490,
    dpr: 2.0,
    screenInch: '1.62"',
    // 胶囊屏安全区域：左右收窄
    safeArea: { top: 20, bottom: 20, left: 20, right: 20 }
  },
  {
    id: 'redmiwatch5',
    name: 'Redmi Watch',
    nameCn: '红米手表',
    shape: 'rect',
    width: 432,
    height: 514,
    dpr: 2.0,
    screenInch: '2.07"'
  }
];

export function getDeviceById(id: string): DeviceConfig {
  return DEVICES.find(d => d.id === id) || DEVICES[1];
}

export function getDeviceShapeClipPath(device: DeviceConfig, scale: number = 1): string {
  const w = device.width * scale;
  const h = device.height * scale;
  switch (device.shape) {
    case 'circle':
      return `circle(${Math.min(w, h) / 2}px at center)`;
    case 'capsule':
      const r = Math.min(w, h) / 2;
      return `inset(0 round ${r}px)`;
    case 'rect':
    default:
      // 矩形屏轻微圆角（模拟手环/手表外观）
      const radius = device.id === 'band9pro' ? 28 * scale :
                     device.id === 'redmiwatch5' ? 36 * scale : 8 * scale;
      return `inset(0 round ${radius}px)`;
  }
}
