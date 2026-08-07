# LURE · Dredge-like Fishing Prototype

一个 Dredge 风格的钓鱼 / 冒险游戏原型，使用 Three.js 做 3D 场景，Phaser 保留作为 UI 层。

美术方向：**低多边形 (low-poly) + 卡通着色 (toon shader)**，参考 Peak / Dredge 的手绘感。

## 目录结构

```
├── index.html          Phaser 主入口（游戏 UI 层，Dev 中）
├── prototype.html      Three.js 试玩原型（水体 + 船 + 石头 + WASD 控制）
├── editor.html         场景编辑器（网格化布置礁石 / 岛屿 / 码头 …）
├── src/
│   ├── proto/          原型场景（含 shader、船只、物理）
│   ├── editor/         编辑器（gizmo、模型库、glTF 加载）
│   ├── scenes/         Phaser 场景
│   └── ui/             Phaser UI 组件
└── public/models/      外部 glTF 模型（石头等）
```

## 快速开始

```bash
npm install
npm run dev
```

默认打开 `editor.html`。

- 在编辑器里网格化摆放礁石 / 岛屿 → Ctrl+S 或自动保存到 localStorage
- 点右上"试玩"→ 跳转 `prototype.html`，读取同一份场景数据
- 试玩里 **WASD** 前进/后退/转向，**鼠标拖拽** 环视，**Shift** 慢速档，**Esc** 返回编辑器
- 试玩右侧 GUI 面板调水面/天空/操控参数，**所有调整都自动保存**

## 技术栈

- **Three.js 0.185** —— 3D 渲染 + 自定义 shader
- **Rapier3D (WASM)** —— 船 vs 石头的 kinematic 物理
- **lil-gui** —— 实时参数调节
- **Vite 5 + TypeScript** —— 多页面构建
- **Phaser 3** —— UI / 2D 覆盖层（长期）

## 核心技术亮点

- 程序化天空盒（zenith / horizon / ground / sun，支持日夜切换 preset）
- 风格化水面：Gerstner 波、UV flow、Beer-Lambert 吸收、深度相交泡沫、卡通阶梯光照
- 深度预渲染多 pass 管线（DepthTexture → 水下场景 tint）
- 船体波浪浮力（在 JS 端复算 Gerstner 高度 + 坡度 → 船 roll/pitch 完美贴浪）
- 编辑器 UE 风 gizmo（TransformControls），W/E/R 切换模式，Shift 吸附
- 全参数 localStorage 持久化（试玩场景数据 + shader/操控/视角参数）

## 设计文档

根目录几份中文 md 是策划案 / 分镜清单 / 技术栈规划，供参考。

## Build

```bash
npm run build      # 输出到 dist/
npm run preview    # 预览 build 产物
```
