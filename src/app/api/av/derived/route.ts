import { NextResponse } from 'next/server';
import { listProjects } from '@/server/db';
import { currentUser } from '@/server/session';
import { denyAvModule } from '@/server/avguard';
import { identityOf, visibleProjects } from '@/lib/permissions';
import { latestConfig } from '@/server/avdb';
import { compute } from '@/av/core/compute';
import type { LedConfig } from '@/av/core/types';

/* ===== REQ-039 收尾:资料卡上那四个数从 LED 方案配置带过来 =====
   数量 L / 数量 H / 电源线 / 数据线。0917 当时定的是「一律手填」,那是因为
   还没有计算规则;现在 LED 规则包里有 F3(箱体排布)和 F6–F9(回路与线缆),
   资料卡上那四个数正是它们的输出。

   为什么不做成资料卡上的公式字段:算这四个数要先解出箱体排布,而排布要箱体
   库、模组尺寸、控制系统这些参数 —— 资料卡上只有长、宽、点间距、类型,没有
   这些,再多的公式也算不出来。算得出的地方只有方案配置。

   为什么在服务端重算而不是读 summary:存下来的 summary 里有箱体总数和两种
   线缆,但没有横竖各几只(数量 L / H 要的就是这个)。内核是确定性的,拿存着
   的那份 cfg 和当时绑定的规则包版本重跑一遍,结果和当初算出来的一模一样。

   一次返回所有能看见的项目:资料卡在项目里看,登记表是跨项目一张表 —— 后者
   逐个项目去问就是几十次请求。可见性沿用 REQ-043。 */

export interface AvDerived {
  qtyL: number;      // 箱体列数
  qtyH: number;      // 箱体行数
  qtyTotal: number;
  powerCable: number;  // F7,含 1 根备用
  dataCable: number;   // F9,含 1 根备用
  packVersion: string;
  at: number;        // 这份配置是什么时候算的
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }

  const out: Record<string, AvDerived> = {};
  for (const p of visibleProjects(identityOf(user), listProjects())) {
    const saved = latestConfig(p.id, 'led');
    if (!saved) continue;
    try {
      const r = compute(saved.cfg as LedConfig, saved.packVersion);
      if (!r.layout || !r.wiring) continue;   // 尺寸解不出箱体排布,给不出这四个数
      out[p.id] = {
        qtyL: r.layout.widths.length,
        qtyH: r.layout.heights.length,
        qtyTotal: r.layout.widths.length * r.layout.heights.length,
        powerCable: r.wiring.nPowerCable,
        dataCable: r.wiring.nDataCable,
        packVersion: saved.packVersion,
        at: saved.createdAt,
      };
    } catch {
      /* 老配置碰上改过的规则包可能算不动。算不动就当没有 —— 资料卡那几格
         退回手填,总比显示一个算错的数强。 */
    }
  }
  return NextResponse.json({ derived: out });
}
