"""AV 方案成本平台 · 制图服务.

DXF generation and drawing ingest for the LED business line, per §8 and §14 of
《LED 业务线开发交付规格说明书 v1.0》.

The geometry itself is produced by the TypeScript core (src/av/core) and handed
over as the drawing JSON described in schema.py, so the SVG and DXF renderers
share one geometry source and one set of group names (§8.2).
"""

__all__ = ["dxf", "schema"]
