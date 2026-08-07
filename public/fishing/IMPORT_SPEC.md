# 钓鱼场景素材导入与命名规范

## 导入目录

```text
public/fishing/
├─ biomes/
│  ├─ mist-lake/                 # 场景一：晨雾湖区
│  │  ├─ reference/              # 合成参考图，不参与运行时加载
│  │  ├─ sky/                    # 天空基础图
│  │  ├─ far/                    # 最远山脉块
│  │  ├─ middle/                 # 中景山脉与森林块
│  │  ├─ islands/                # 独立岛屿组件
│  │  ├─ water/                  # 水面基础、波纹、倒影
│  │  ├─ underwater/
│  │  │  ├─ background/          # 纵向水下背景长图
│  │  │  └─ decor/               # 水草、岩石等PCG装饰
│  │  └─ fx/                     # 雾、光束、环境颗粒
│  └─ purple-dusk/               # 场景二：蓝紫暮光湖区
│     └─ 与 mist-lake 相同结构
└─ shared/
   ├─ fish/                      # 两个场景共用鱼类
   ├─ boat/                      # 船与人物
   └─ fx/                        # 共用气泡、鱼钩等特效
```

## 通用命名规则

- 只使用小写英文、数字和连字符。
- 禁止中文、空格、括号和 `final`、`new` 等无版本意义的名称。
- 两位序号从 `01` 开始。
- 同类变体只增加序号，不在名称中加入颜色描述。
- 文件夹已经表达生态名称，文件名不重复添加 `mist-lake` 等前缀。

```text
<layer>-<type>-<variant>.png
<layer>-<type>-<left-edge>-<right-edge>-<variant>.png
```

PCG接口名称仅使用：

```text
open  # 开阔、无岸线
low   # 低矮缓坡
mid   # 中等高度山体
high  # 高大近景
```

## 文件命名示例

### reference

```text
scene-composite-reference.png
scene-color-reference.png
```

### sky

```text
sky-base.webp
sky-clouds-01.png
sky-clouds-02.png
```

### far

```text
far-mountains-open-open-01.png
far-mountains-open-low-01.png
far-mountains-low-low-01.png
```

### middle

```text
middle-mountains-low-low-01.png
middle-mountains-low-mid-01.png
middle-forest-low-low-01.png
middle-forest-mid-low-01.png
```

### islands

```text
island-small-01.png
island-medium-01.png
island-large-01.png
island-rocky-01.png
```

不要使用 `island-left` 和 `island-right` 表示摆放位置；运行时可以翻转或重新放置组件。

### water

```text
water-surface-base.webp
water-ripples-01.png
water-reflection-01.png
water-foam-01.png
```

### underwater/background

```text
underwater-background-day.webp
underwater-background-night.webp
```

### underwater/decor

```text
rock-small-01.png
rock-medium-01.png
rock-large-01.png
grass-short-01.png
grass-tall-01.png
plant-broadleaf-01.png
```

### fx

```text
fog-valley-01.png
light-rays-01.png
particles-water-01.png
```

### shared

```text
shared/fish/fish-common-01.png
shared/fish/fish-rare-01.png
shared/fish/fish-monster-01.png
shared/boat/boat-base.png
shared/boat/fisher-idle.png
shared/fx/bubbles-01.png
shared/fx/lure-glow-01.png
```

## 格式要求

- 有透明区域：PNG，8位RGBA，Straight Alpha。
- 完全不透明背景：优先WebP。
- 颜色空间：sRGB。
- 水面以上设计母版：2560×1440。
- 水面基准：设计稿 `Y=940`，游戏内 `Y=470`。
- 水下背景建议：2560×4096。
- 第一轮测试不裁切透明画布、不打图集，确认对齐后再优化。

## 首次导入最低文件集

将以下文件放入 `mist-lake` 即可开始第一次PCG测试：

```text
reference/scene-composite-reference.png
sky/sky-base.webp
far/far-mountains-open-open-01.png
far/far-mountains-low-low-01.png
middle/middle-mountains-low-low-01.png
middle/middle-forest-low-low-01.png
islands/island-small-01.png
islands/island-large-01.png
water/water-surface-base.webp
water/water-ripples-01.png
underwater/background/underwater-background-day.webp
underwater/decor/rock-small-01.png
underwater/decor/grass-short-01.png
```
