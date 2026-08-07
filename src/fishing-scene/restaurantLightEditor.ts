import {
  DEFAULT_RESTAURANT_LIGHT_SETTINGS,
  dispatchRestaurantLightSettings,
  loadRestaurantLightSettings,
  saveRestaurantLightSettings,
  type RestaurantLightSettings,
} from './restaurantLightSettings';

type NumericSettingKey = {
  [K in keyof RestaurantLightSettings]: RestaurantLightSettings[K] extends number ? K : never;
}[keyof RestaurantLightSettings];

type ColorSettingKey = {
  [K in keyof RestaurantLightSettings]: RestaurantLightSettings[K] extends string ? K : never;
}[keyof RestaurantLightSettings];

type SliderConfig = {
  key: NumericSettingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
};

const GROUPS: {
  title: string;
  colorKey: ColorSettingKey;
  sliders: SliderConfig[];
}[] = [
  {
    title: '吊灯',
    colorKey: 'pendantColor',
    sliders: [
      { key: 'pendantRadius', label: '扩散半径', min: 15, max: 140, step: 1 },
      { key: 'pendantIntensity', label: '环境亮度', min: 0, max: 1, step: 0.01, digits: 2 },
      { key: 'pendantBloomStrength', label: '灯芯 Bloom', min: 0, max: 1.2, step: 0.01, digits: 2 },
      { key: 'pendantBloomBlur', label: '灯芯模糊', min: 0.2, max: 4, step: 0.05, digits: 2 },
    ],
  },
  {
    title: '月光',
    colorKey: 'doorColor',
    sliders: [
      { key: 'doorRadius', label: '扩散半径', min: 10, max: 120, step: 1 },
      { key: 'doorIntensity', label: '环境亮度', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    title: '窗外晚霞',
    colorKey: 'neonColor',
    sliders: [
      { key: 'neonRadius', label: '扩散半径', min: 10, max: 120, step: 1 },
      { key: 'neonIntensity', label: '环境亮度', min: 0, max: 1, step: 0.01, digits: 2 },
      { key: 'neonBloomStrength', label: 'Bloom 强度', min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: 'neonBloomBlur', label: 'Bloom 模糊', min: 0.2, max: 4, step: 0.05, digits: 2 },
    ],
  },
  {
    title: '鱼缸',
    colorKey: 'tankColor',
    sliders: [
      { key: 'tankRadius', label: '扩散半径', min: 10, max: 100, step: 1 },
      { key: 'tankIntensity', label: '环境亮度', min: 0, max: 0.8, step: 0.01, digits: 2 },
    ],
  },
];

export function createRestaurantLightEditor() {
  if (document.getElementById('restaurant-light-editor')) return;

  let settings = loadRestaurantLightSettings();
  const style = document.createElement('style');
  style.textContent = `
    #restaurant-light-editor-toggle {
      position: fixed; right: 14px; top: 14px; z-index: 10001;
      border: 1px solid rgba(230, 202, 145, .65); border-radius: 8px;
      padding: 8px 13px; color: #f5e8cb; background: rgba(21, 17, 14, .9);
      font: 13px "Noto Serif SC", serif; cursor: pointer;
      box-shadow: 0 5px 18px rgba(0, 0, 0, .3);
    }
    #restaurant-light-editor {
      position: fixed; right: 14px; top: 56px; z-index: 10000;
      width: 292px; max-height: calc(100vh - 70px); overflow: auto;
      padding: 14px; color: #eadfc9; background: rgba(18, 15, 13, .95);
      border: 1px solid rgba(230, 202, 145, .42); border-radius: 10px;
      box-shadow: 0 12px 38px rgba(0, 0, 0, .45);
      font: 12px "Noto Serif SC", serif; backdrop-filter: blur(10px);
    }
    #restaurant-light-editor[hidden] { display: none; }
    #restaurant-light-editor h2 { margin: 0 0 4px; font-size: 16px; color: #fff2d4; }
    #restaurant-light-editor .light-help { margin: 0 0 12px; color: #a99b84; line-height: 1.5; }
    #restaurant-light-editor fieldset {
      margin: 0 0 10px; padding: 9px 10px 7px;
      border: 1px solid rgba(230, 202, 145, .18); border-radius: 7px;
    }
    #restaurant-light-editor legend { padding: 0 6px; color: #d9b876; }
    #restaurant-light-editor label {
      display: grid; grid-template-columns: 72px 1fr 40px;
      gap: 8px; align-items: center; margin: 6px 0;
    }
    #restaurant-light-editor input[type="range"] { width: 100%; accent-color: #d89a55; }
    #restaurant-light-editor input[type="color"] {
      width: 42px; height: 25px; padding: 1px; border-radius: 5px;
      border: 1px solid rgba(230, 202, 145, .35); background: transparent; cursor: pointer;
    }
    #restaurant-light-editor output { color: #f4d7a4; text-align: right; font-variant-numeric: tabular-nums; }
    #restaurant-light-editor .light-actions { display: flex; gap: 8px; }
    #restaurant-light-editor button {
      flex: 1; border: 1px solid rgba(230, 202, 145, .35); border-radius: 6px;
      padding: 7px; color: #eadfc9; background: #30251e; cursor: pointer;
      font: inherit;
    }
    #restaurant-light-editor button:hover { border-color: #e0b56e; }
  `;
  document.head.appendChild(style);

  const toggle = document.createElement('button');
  toggle.id = 'restaurant-light-editor-toggle';
  toggle.type = 'button';
  toggle.textContent = '灯光编辑器';

  const panel = document.createElement('aside');
  panel.id = 'restaurant-light-editor';
  panel.hidden = true;
  panel.innerHTML = `
    <h2>餐厅灯光编辑器</h2>
    <p class="light-help">营业场景中实时生效。扩散半径控制光晕范围，环境亮度控制整体提亮。</p>
  `;

  const inputs = new Map<NumericSettingKey, HTMLInputElement>();
  const outputs = new Map<NumericSettingKey, HTMLOutputElement>();
  const colorInputs = new Map<ColorSettingKey, HTMLInputElement>();

  const refreshControls = () => {
    for (const group of GROUPS) {
      const colorInput = colorInputs.get(group.colorKey);
      if (colorInput) colorInput.value = settings[group.colorKey];
      for (const slider of group.sliders) {
        const input = inputs.get(slider.key);
        const output = outputs.get(slider.key);
        if (!input || !output) continue;
        input.value = String(settings[slider.key]);
        output.value = settings[slider.key].toFixed(slider.digits ?? 0);
      }
    }
  };

  const preview = () => {
    dispatchRestaurantLightSettings(settings);
  };

  for (const group of GROUPS) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.title;
    fieldset.appendChild(legend);

    const colorLabel = document.createElement('label');
    const colorTitle = document.createElement('span');
    colorTitle.textContent = 'Bloom 颜色';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = settings[group.colorKey];
    colorInputs.set(group.colorKey, colorInput);
    const colorOutput = document.createElement('output');
    colorOutput.value = settings[group.colorKey].toUpperCase();
    colorInput.addEventListener('input', () => {
      settings = { ...settings, [group.colorKey]: colorInput.value };
      colorOutput.value = colorInput.value.toUpperCase();
      preview();
    });
    colorLabel.append(colorTitle, colorInput, colorOutput);
    fieldset.appendChild(colorLabel);

    for (const slider of group.sliders) {
      const label = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = slider.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(slider.step);
      const output = document.createElement('output');
      inputs.set(slider.key, input);
      outputs.set(slider.key, output);
      input.addEventListener('input', () => {
        settings = { ...settings, [slider.key]: Number(input.value) };
        output.value = settings[slider.key].toFixed(slider.digits ?? 0);
        preview();
      });
      label.append(title, input, output);
      fieldset.appendChild(label);
    }
    panel.appendChild(fieldset);
  }

  const actions = document.createElement('div');
  actions.className = 'light-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '保存全部参数';
  save.addEventListener('click', () => {
    saveRestaurantLightSettings(settings);
    dispatchRestaurantLightSettings(settings);
    save.textContent = '已保存';
    window.setTimeout(() => { save.textContent = '保存全部参数'; }, 1200);
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => {
    settings = { ...DEFAULT_RESTAURANT_LIGHT_SETTINGS };
    refreshControls();
    preview();
  });
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制参数';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
    copy.textContent = '已复制';
    window.setTimeout(() => { copy.textContent = '复制参数'; }, 1200);
  });
  actions.append(save, reset, copy);
  panel.appendChild(actions);

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.textContent = panel.hidden ? '灯光编辑器' : '收起灯光编辑器';
  });

  document.body.append(toggle, panel);
  refreshControls();
}
