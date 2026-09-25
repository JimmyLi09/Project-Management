# AV 方案成本平台 · 制图服务

Python 侧，负责规格书 §14 指定给 Python 的两件事：**DXF 生成**（ezdxf）与**图纸解析**。

几何不在这里产生。屏体轮廓、箱体、模组、回路、数据线、标注与信息栏全部由
TypeScript 内核 `src/av/core/drawing.ts` 算出，以 drawing JSON 交过来，本服务只做渲染。
SVG 与 DXF 因此共享同一套几何与同一套分组名（§8.2）。

## 环境

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

## 生成 DXF

```bash
# 先由 TS 侧产出 drawing JSON
npm run led:drawing -- 144 out            # 仓库根目录执行

# 再渲染为 DXF
cd services/drawing
.venv/bin/python -m avdrawing.dxf ../../out/144-chuan-grove.drawing.json out.dxf
```

输出为 R2010、单位 mm（`$INSUNITS = 4`）、原点位于屏体左下角，含 §8.1 的八个图层：

| 图层 | ACI | 内容 |
| --- | --- | --- |
| LED-01-屏体轮廓 | 7 白 | 屏体外轮廓 |
| LED-02-箱体 | 1 红 | 标准箱体、编号 RxCy、规格文字 |
| LED-02B-定制箱体 | 6 品红 | 库外规格箱体，单独成层便于筛选 |
| LED-03-模组 | 8 灰 | 模组分格线 |
| LED-04-电源回路 | 2 黄 | 回路分组线、引下线、功率与线规 |
| LED-05-数据线 | 3 绿 | 走线、编号圆圈、FOR SPARE |
| LED-06-标注 | 4 青 | 尺寸线与尺寸文字 |
| LED-07-文字 | 7 白 | 图纸信息栏 |

八个图层一律创建，即使当次没有内容（例如无定制箱体时的 LED-02B），以保证在 AutoCAD 中
始终可独立开关（验收 A7）。

中文字符使用文字样式 `AV-HZ`（字体 `simsun.ttc`）。CAD 找不到该字体时会回退到自带字体，
字形会变但几何不受影响。

## 图纸解析（03 解析提取 / 04 人工校核）

```python
from pathlib import Path
from avdrawing.ingest import pipeline
from avdrawing.ingest.pdf_reader import Calibration

pipeline.ingest(Path("01_平面图.dxf"))                                   # A 级
pipeline.ingest(Path("02_立面图.pdf"), calibration=Calibration.from_scale(50))  # B 级
pipeline.ingest(Path("03_扫描件.pdf"), ocr_backend=PaddleOcrBackend())   # C 级
```

产出六条带 provenance 三标签的要素记录。B 级必须先标定比例尺、C 级必须提供 OCR 引擎，
两者都不会被推断 —— 错误的比例或缺失的引擎会产出看起来很正常的错数字。

扫描件按 §13.2 不可作为算量依据：置信度上限压到 0.75，且必须逐项人工确认才放行到 05。

### 可选依赖

```bash
.venv/bin/pip install -r requirements-ocr.txt   # C 级 OCR，体积大，首次运行下载权重
```

图例视觉识别需要 `ANTHROPIC_API_KEY`（或 `ant auth login` 的配置），模型按 §14 用
Claude Sonnet。

## 测试

```bash
.venv/bin/python -m pytest
```

`tests/fixtures/144-chuan-grove.drawing.json` 是跨语言契约样本，由
`npm run led:drawing -- 144 services/drawing/tests/fixtures` 重新生成。
