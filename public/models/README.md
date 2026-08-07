# 外部模型资源

放在这个目录下的文件（`.glb` / `.gltf` / 贴图）会被 Vite 作为静态资源直出到根路径。
例：`public/models/rock_small.glb` → 运行时通过 `/models/rock_small.glb` 访问。

---

## 自动加载清单（放对文件名就自动生效）

启动时（编辑器 + prototype 两处）会通过 `bootstrapExternalGltf()` 顺序加载以下文件。
**只要把 `.glb` 放到对应路径、刷新页面就注册好了，不用改任何代码。**

| 期望路径                              | 模型 id          | 名称       | fitSize (m) | 分类     |
| ------------------------------------- | ---------------- | ---------- | ----------- | -------- |
| `public/models/rock_small.glb`        | `rock_small`     | 礁石(小)   | 2.5         | obstacle |
| `public/models/rock_medium.glb`       | `rock`           | 礁石(中)   | 4.0         | obstacle |
| `public/models/rock_large.glb`        | `rock_large`     | 礁石(大)   | 8.0         | obstacle |
| `public/models/island_small.glb`      | `island_small`   | 小岛(小)   | 5.0         | landmark |
| `public/models/island_medium.glb`     | `island_medium`  | 小岛(中)   | 9.0         | landmark |

- 文件不存在会 warn 一行、跳过，不影响其他模型
- `fitSize` = 把整个 glTF 的最长包围盒边等比缩放到多少米（`grid.cellSize = 4m`，一格 = 4m）
- 加载完自动：`stylize`（3渲2 化 · 保留 baseColor/normal/AO）+ `centerXZ` + `groundYToZero`
- 底部沉入量 `yOffset` 由包围盒自动推算（约 20% 高度，上限 0.4m）

想加新档 / 改档位，改 `src/editor/main.ts` 里 `bootstrapUserModels()` + `src/proto/main.ts` 里 `loadEditorScene()` 中的调用即可。

---

## 建模导出建议（Blender / Maya / Substance 通用）

- **坐标系**：Y 轴朝上，导出 glTF 时勾选 `+Y Up`
- **朝向**：模型面向 -Z（Blender 默认前）；游戏里放置后可以再在编辑器里绕 Y 旋转
- **原点**：把 pivot 放在**模型底部中心**，加载器会自动 XZ 居中 + 底部对齐 y=0
- **尺寸**：随意，加载器会按 `fitSize` 归一化 —— 只要各部件之间比例正确即可
- **材质**：PBR（Base Color / Normal / AO / Roughness）都保留，`stylize` 会转成 StylizedMaterial 但会**保留贴图、法线、AO**
- **顶点色**：会保留（用于 wet/dry 之类分段染色）
- **多子物件的 .glb**：顶层子节点数 > 1 时会自动"拆解"—— 每个子节点注册成一个独立模型（id 后加 `_1` `_2` …）；如果只想要一个整体，把所有几何合并到一个顶层节点

---

## 其他方式

### 拖拽 / 上传自定义 glTF
- **拖拽**：把 `.glb` / `.gltf` 拖进编辑器窗口任意位置 → 自动加入模型库并选中
- **按钮**：左侧模型库下面 `+ 导入 .glb / .gltf`

⚠️ 这种方式只在当前会话有效，刷新页面后自定义模型会消失
（因为浏览器无法保留本地文件路径）。要长期使用请放到 `public/models/` 并加进 `bootstrapUserModels()`。

### 手动 registerModel（用同名 id 覆盖）
```ts
import { loadGLTFModel } from './loadGLTF';
import { registerModel } from './models';

loadGLTFModel('/models/whatever.glb', {
  fitSize: 3.0,
  stylize: true,           // 3渲2 材质（保留贴图/法线/AO）
  groundYToZero: true,
  centerXZ: true,
}).then((build) => {
  registerModel({
    id: 'whatever',
    name: '自定义',
    swatch: '#888',
    category: 'obstacle',
    yOffset: -0.2,
    build,
    rotatable: true,
    scalable: true,
  });
});
```

## `loadGLTFModel` / `loadGLTFExploded` 常用选项

| 参数            | 默认    | 说明                                                      |
| --------------- | ------- | --------------------------------------------------------- |
| `fitSize`       | 不缩放  | 把最长包围盒边等比缩放到该米数                            |
| `groundYToZero` | `true`  | 底部对齐到 y=0（配合 `ModelDef.yOffset` 精细调整下沉量）  |
| `centerXZ`      | `true`  | XZ 中心对齐原点                                           |
| `stylize`       | `false` | 转成 StylizedMaterial（保留贴图/法线/AO/vertexColors）    |
| `colorMultiply` | 无      | 把 baseColor 整体乘一个系数或颜色（提亮 / 染色）          |
| `shadows`       | `true`  | 全 mesh 开启 castShadow / receiveShadow                   |

## 高级情况

- **Draco 压缩的 .glb**：需要额外注册 `DRACOLoader`（当前未启用）
- **KTX2 压缩贴图**：需要额外注册 `KTX2Loader`（当前未启用）
- **骨骼动画**：`root.clone(true)` 不复制 skeleton，需要走 `SkeletonUtils.clone`（静态道具用不到）
